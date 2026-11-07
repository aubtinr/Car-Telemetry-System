"""Mock source: synthesize *raw* STM frames and push them through the real pipeline.

Important: the mock emits the same NDJSON raw lines a real STM would, and they go
through `engine.ingest_line` exactly like hardware. So mock mode exercises the
decoder, the framing tolerance, and the freshness logic -- not just the UI.

Scenarios (TELEM_MOCK_SCENARIO):
  drive  -- a calm, plausible healthy drive. Good for a first look / demo.
  cycle  -- rotates through the required test states so each can be seen:
            normal -> stale-coolant -> unsupported-O2 -> unplug -> reconnect -> ...
            Trouble codes P0301 + P0420 are reported during stale-coolant and
            unsupported-O2; during reconnect the ECU "doesn't answer" the DTC request.
"""
from __future__ import annotations

import json
import math
import random
import threading
import time
from typing import Callable

from .config import config
from .state import TelemetryEngine

PERIOD_S = 0.1  # 10 Hz; real hardware runs roughly 10-20 Hz
DTC_PERIOD_S = 5.0  # matches the firmware's Mode 03 check


def _hex(*vals: int) -> str:
    return "".join(f"{v & 0xFF:02X}" for v in vals)


class MockSource:
    def __init__(self, engine: TelemetryEngine, on_frame: Callable[[], None]) -> None:
        self.engine = engine
        self._on_frame = on_frame
        self._thread = None
        self._stop = threading.Event()
        self._seq = 0
        self._t0 = time.monotonic()
        self._boot = time.monotonic()
        self._last_dtc: float | None = None

    @property
    def connected(self) -> bool:
        return True  # the "serial port" (our generator) is always open in mock mode

    @property
    def mode(self) -> str:
        return "mock"

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="mock-source", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)

    # ---- waveform: a gentle, believable drive ----------------------------

    def _readings(self, t: float):
        # Smooth pseudo-driving profile.
        speed = 55 + 45 * (0.5 + 0.5 * math.sin(t / 18.0)) + random.uniform(-2, 2)
        speed = max(0, min(160, speed))
        rpm = 900 + speed * 34 + 400 * math.sin(t / 5.0) + random.uniform(-80, 80)
        rpm = max(700, min(6500, rpm))
        coolant = min(95, 35 + t * 1.2) + random.uniform(-0.5, 0.5)   # warms up then holds
        throttle = max(0, min(100, 18 + 22 * math.sin(t / 4.0) + random.uniform(-3, 3)))
        maf = max(1.0, 2 + throttle * 0.25 + rpm / 900.0 + random.uniform(-0.4, 0.4))
        o2 = max(0.1, min(0.9, 0.45 + 0.35 * math.sin(t / 1.3)))
        return rpm, speed, coolant, maf, throttle, o2

    def _encode_raw(self, rpm, speed, coolant, maf, throttle, o2, skip=()):
        """Turn real values back into raw OBD data bytes (inverse of the formulas)."""
        pids = {}
        if "rpm" not in skip:
            r = int(round(rpm * 4))
            pids["0C"] = _hex((r >> 8) & 0xFF, r & 0xFF)
        if "speed_kmh" not in skip:
            pids["0D"] = _hex(int(round(speed)))
        if "coolant_c" not in skip:
            pids["05"] = _hex(int(round(coolant)) + 40)
        if "maf_g_s" not in skip:
            m = int(round(maf * 100))
            pids["10"] = _hex((m >> 8) & 0xFF, m & 0xFF)
        if "throttle_pct" not in skip:
            pids["11"] = _hex(int(round(throttle * 255 / 100)))
        if "o2_v" not in skip:
            pids["14"] = _hex(int(round(o2 * 200)), 0x80)
        return pids

    # ---- scenario state machine -----------------------------------------

    def _scenario_params(self, elapsed: float):
        """Return (skip_fields, unsupported_fields, emit_frame) for 'cycle'."""
        if config.mock_scenario != "cycle":
            # 'drive': occasionally skip a sample so ages wiggle a little, nothing dramatic.
            skip = {"o2_v"} if (int(elapsed * 5) % 37 == 0) else set()
            return skip, set(), True

        phase = int(elapsed // 8) % 5
        if phase == 0:          # 0-8s  normal
            return set(), set(), True
        if phase == 1:          # 8-16s coolant goes stale (stops updating)
            return {"coolant_c"}, set(), True
        if phase == 2:          # 16-24s O2 reported unsupported
            return {"o2_v"}, {"o2_v"}, True
        if phase == 3:          # 24-32s STM unplugged: emit NO frames at all
            return set(), set(), False
        return set(), set(), True  # 32-40s reconnected

    def _run(self) -> None:
        next_t = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            if now < next_t:
                time.sleep(min(PERIOD_S, next_t - now))
                continue
            next_t += PERIOD_S

            elapsed = now - self._t0
            skip, unsupported, emit = self._scenario_params(elapsed)
            if not emit:
                continue  # simulate the link going silent

            rpm, speed, coolant, maf, throttle, o2 = self._readings(elapsed)
            pids = self._encode_raw(rpm, speed, coolant, maf, throttle, o2, skip=skip)

            self._seq = (self._seq + 1) % (1 << 32)
            uptime_ms = int((now - self._boot) * 1000)
            obj = {
                "type": "obd_raw",
                "v": 1,
                "seq": self._seq,
                "uptime_ms": uptime_ms,
                "pids": pids,
            }
            if unsupported:
                obj["unsupported"] = [self._pid_for(f) for f in unsupported]
            self._emit(obj)

            if self._last_dtc is None or now - self._last_dtc >= DTC_PERIOD_S:
                self._last_dtc = now
                self._emit(self._dtc_line(elapsed, uptime_ms))

    def _emit(self, obj: dict) -> None:
        line = json.dumps(obj, separators=(",", ":"))
        if self.engine.ingest_line(line):
            self._on_frame()

    @staticmethod
    def _dtc_line(elapsed: float, uptime_ms: int) -> dict:
        codes: list[str] = []
        responded = 1
        if config.mock_scenario == "cycle":
            phase = int(elapsed // 8) % 5
            if phase in (1, 2):
                codes = ["0301", "0420"]  # raw bytes for P0301 (misfire), P0420 (catalyst)
            elif phase == 4:
                responded = 0
        return {
            "type": "obd_dtc",
            "v": 1,
            "uptime_ms": uptime_ms,
            "responded": responded,
            "codes": codes,
        }

    @staticmethod
    def _pid_for(field: str) -> str:
        from .obd import PIDS
        for p in PIDS:
            if p.field == field:
                return p.pid
        return "00"
