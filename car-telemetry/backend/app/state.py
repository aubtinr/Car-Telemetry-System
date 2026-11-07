"""Telemetry state: turn a stream of decoded raw frames into the browser envelope.

Responsibilities (handoff sections 4 & 5), all on the Pi side here:
  - hold one cached value + last-success time per PID,
  - compute per-field age in ms (a fresh *frame* must not reset an old *reading*),
  - track supported = true / false / null (null = discovery incomplete),
  - detect sequence gaps and STM reboots (uptime discontinuity => new session),
  - decide STM link = fresh / stale / disconnected,
  - assemble the page-3 `telemetry` frame and the page-5 `telemetry_update` envelope.

Thread-safety: `ingest_line` runs on the serial-reader thread; `build_envelope`
runs on the asyncio server. A single lock guards the shared snapshot.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from .config import config
from .obd import (
    DTC_TYPE,
    FIELDS,
    DecodeResult,
    DtcResult,
    RawFrameError,
    parse_dtc_frame,
    parse_raw_frame,
)

if TYPE_CHECKING:
    from .laps import LapRecorder

FRAME_VERSION = 1
UINT32 = 1 << 32


def _utc_iso() -> str:
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


class TelemetryEngine:
    def __init__(self) -> None:
        self._lock = threading.Lock()

        # Per-field cache. monotonic seconds of last valid sample, and the value.
        self._value: dict[str, Optional[float]] = {f: None for f in FIELDS}
        self._last_good_mono: dict[str, Optional[float]] = {f: None for f in FIELDS}
        # supported: True / False / None(=unknown yet)
        self._supported: dict[str, Optional[bool]] = {f: None for f in FIELDS}

        # Frame-level tracking
        self._last_frame_mono: Optional[float] = None
        self._last_frame_utc: Optional[str] = None
        self._seq: Optional[int] = None
        self._prev_seq: Optional[int] = None
        self._prev_uptime: Optional[int] = None
        self._source_session: int = 0  # increments on reboot/uptime discontinuity
        self._have_valid_frame = False

        # Trouble codes (Mode 03), refreshed by a separate obd_dtc line every ~5 s.
        self._dtc_codes: list[str] = []
        self._dtc_responded = False
        self._dtc_checked_mono: Optional[float] = None

        # Receives every decoded frame + DTC list while a lap is recording.
        self.recorder: Optional["LapRecorder"] = None

        # Diagnostics / error counters
        self.err_parse = 0        # bad JSON or structural RawFrameError
        self.err_oversize = 0     # lines over the byte cap (counted by the reader)
        self.err_decode = 0       # per-PID decode problems
        self.seq_gaps = 0         # total missed frames inferred from seq jumps

    # ---- ingestion -------------------------------------------------------

    def ingest_line(self, line: str) -> bool:
        """Process one complete serial line (already framed, CR trimmed).

        Returns True if it yielded a valid frame that advanced state.
        Never raises: a malformed line is counted and dropped.
        """
        line = line.strip()
        if not line:
            return False
        try:
            obj = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            with self._lock:
                self.err_parse += 1
            return False
        try:
            if isinstance(obj, dict) and obj.get("type") == DTC_TYPE:
                dtc = parse_dtc_frame(obj)
                self._apply_dtc(dtc)
                if self.recorder is not None:
                    self.recorder.add_codes(dtc.codes)
            else:
                result = parse_raw_frame(obj)
                self._apply(result)
                if self.recorder is not None:
                    self.recorder.add_sample(result.values)
        except RawFrameError:
            with self._lock:
                self.err_parse += 1
            return False
        return True

    def note_oversize(self) -> None:
        with self._lock:
            self.err_oversize += 1

    def _apply_dtc(self, r: DtcResult) -> None:
        with self._lock:
            self.err_decode += r.decode_errors
            self._dtc_responded = r.responded > 0
            self._dtc_codes = r.codes
            self._dtc_checked_mono = time.monotonic()

    def _apply(self, r: DecodeResult) -> None:
        now = time.monotonic()
        with self._lock:
            self.err_decode += r.decode_errors

            # Reboot / tick-wrap detection: a drop in uptime means a new STM session.
            if r.uptime_ms is not None and self._prev_uptime is not None:
                if r.uptime_ms < self._prev_uptime:
                    self._source_session += 1
                    self._prev_seq = None  # don't count the discontinuity as a gap
            if r.uptime_ms is not None:
                self._prev_uptime = r.uptime_ms

            # Sequence-gap accounting (unsigned 32-bit wrap aware).
            if r.seq is not None:
                if self._prev_seq is not None:
                    delta = (r.seq - self._prev_seq) % UINT32
                    if delta > 1:
                        self.seq_gaps += delta - 1
                self._prev_seq = r.seq
                self._seq = r.seq

            # Supported discovery: unsupported wins; any valid sample => supported.
            for f in r.unsupported:
                self._supported[f] = False
            for f, v in r.values.items():
                self._value[f] = v
                self._last_good_mono[f] = now
                self._supported[f] = True

            self._last_frame_mono = now
            self._last_frame_utc = _utc_iso()
            self._have_valid_frame = True

    # ---- snapshot / envelope --------------------------------------------

    def _stale_threshold_ms(self, field_name: str) -> int:
        return config.stale_coolant_ms if field_name == "coolant_c" else config.stale_default_ms

    def build_envelope(self, mode: str, serial_connected: bool) -> dict:
        """Assemble the WebSocket envelope from current state. Safe to call anytime."""
        now = time.monotonic()
        with self._lock:
            if self._last_frame_mono is None:
                last_frame_age_ms: Optional[int] = None
                link = "disconnected"
            else:
                last_frame_age_ms = int(round((now - self._last_frame_mono) * 1000))
                if not serial_connected:
                    link = "disconnected"
                elif last_frame_age_ms > config.stm_link_timeout_ms:
                    link = "stale"
                else:
                    link = "fresh"

            frame = None
            if self._have_valid_frame:
                values: dict[str, Optional[float]] = {}
                age_ms: dict[str, Optional[int]] = {}
                stale: dict[str, bool] = {}
                for f in FIELDS:
                    values[f] = _round(self._value[f])
                    lg = self._last_good_mono[f]
                    if lg is None:
                        age_ms[f] = None
                        stale[f] = False
                    else:
                        a = int(round((now - lg) * 1000))
                        age_ms[f] = a
                        stale[f] = a > self._stale_threshold_ms(f)
                frame = {
                    "type": "telemetry",
                    "v": FRAME_VERSION,
                    "seq": self._seq,
                    "uptime_ms": self._prev_uptime,
                    "values": values,
                    "age_ms": age_ms,
                    "supported": dict(self._supported),
                    # convenience for the UI; derivable from age_ms + thresholds.
                    "stale": stale,
                }

            if self._dtc_checked_mono is None:
                dtc_status = "pending"
                dtc_age_ms: Optional[int] = None
            else:
                dtc_status = "ok" if self._dtc_responded else "no_response"
                dtc_age_ms = int(round((now - self._dtc_checked_mono) * 1000))

            return {
                "type": "telemetry_update",
                "v": FRAME_VERSION,
                "mode": mode,  # "live" or "mock"
                "serial_connected": serial_connected,
                "stm_link": link,  # fresh | stale | disconnected
                "last_frame_age_ms": last_frame_age_ms,
                "received_at": self._last_frame_utc,
                "source_session": self._source_session,
                "errors": {
                    "parse": self.err_parse,
                    "oversize": self.err_oversize,
                    "decode": self.err_decode,
                    "seq_gaps": self.seq_gaps,
                },
                "frame": frame,
                "dtc": {
                    "status": dtc_status,  # pending | ok | no_response
                    "codes": list(self._dtc_codes),
                    "age_ms": dtc_age_ms,
                    "stale": dtc_age_ms is not None and dtc_age_ms > config.dtc_stale_ms,
                },
            }

    def health(self, mode: str, serial_connected: bool) -> dict:
        env = self.build_envelope(mode, serial_connected)
        return {
            "status": "ok",
            "mode": env["mode"],
            "serial_connected": env["serial_connected"],
            "stm_link": env["stm_link"],
            "last_frame_age_ms": env["last_frame_age_ms"],
            "source_session": env["source_session"],
            "errors": env["errors"],
            "dtc": env["dtc"],
        }

    def reset_stream_state(self) -> None:
        """Called on serial reopen: a new physical connection starts a new session."""
        with self._lock:
            self._prev_seq = None
            self._prev_uptime = None
            self._source_session += 1


def _round(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    return round(v, 3)
