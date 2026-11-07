"""OBD-II decode layer  --  the raw-bytes -> real-units translation.

======================================================================
THIS IS THE ONE MODULE TO REVISIT ONCE THE FIRMWARE AUTHOR CONFIRMS THE
EXACT RAW FRAME LAYOUT. Everything else in the backend consumes decoded
values and never touches raw bytes.
======================================================================

Design decision (from the build conversation): the STM32 sends RAW, untranslated
OBD-II responses -- it talks to the car over the OBD-II/CAN port and forwards the
direct data bytes. The Pi applies the standard OBD-II (SAE J1979, Mode 01)
formulas to turn those bytes into rpm / km/h / degC / g·s⁻¹ / % / V.

----------------------------------------------------------------------
RAW FRAME SCHEMA (STM32 -> Pi), newline-delimited JSON, one object per line:

  {"type":"obd_raw","v":1,"seq":1042,"uptime_ms":208400,
   "pids":{"0C":"218C","0D":"30","05":"7F","10":"0280","11":"38","14":"6F80"},
   "unsupported":["..."],   # optional: PIDs the ECU reported as unsupported
   "no_response":["..."]}   # optional: PIDs polled this cycle that did not answer

  - "pids": map of Mode-01 PID (two hex chars) -> the response DATA bytes as a
    hex string (A, B, ... with no mode/pid echo, no spaces). Only PIDs that
    returned data this cycle appear here.
  - A PID absent from every frame so far  -> "never seen"  -> value/age null.
  - A PID listed in "unsupported"          -> supported=false (not a numeric 0).
  - A PID in "no_response"                 -> keep last value, let its age grow.

If the firmware instead echoes the mode byte, sends decoded values, uses a
different key, or packs bytes differently, adjust `parse_raw_frame` and the
`PIDS` table below -- nothing downstream changes.

TROUBLE CODES (Mode 03), a separate line sent every ~5 s:

  {"type":"obd_dtc","v":1,"uptime_ms":208400,"responded":1,"codes":["0301","0420"]}

  - "responded": how many ECUs answered the request (0 = nobody answered, so
    "no codes" cannot be claimed).
  - "codes": each DTC as its two raw bytes in hex; decoded here to "P0301" etc.
----------------------------------------------------------------------
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

RAW_TYPE = "obd_raw"
DTC_TYPE = "obd_dtc"
RAW_VERSION = 1

# First two bits of a DTC's high byte pick the system (SAE J2012).
_DTC_SYSTEMS = "PCBU"


@dataclass(frozen=True)
class PidSpec:
    pid: str                        # Mode-01 PID, two hex chars, e.g. "0C"
    field: str                      # UI field name, e.g. "rpm"
    n_bytes: int                    # number of DATA bytes expected in the response
    unit: str                       # canonical unit emitted to the UI
    decode: Callable[[list[int]], Optional[float]]  # data bytes -> value (SI-ish)


def _rpm(b: list[int]) -> Optional[float]:
    # PID 0C: ((A*256)+B)/4  rpm
    return ((b[0] << 8) + b[1]) / 4.0


def _speed(b: list[int]) -> Optional[float]:
    # PID 0D: A  km/h
    return float(b[0])


def _coolant(b: list[int]) -> Optional[float]:
    # PID 05: A-40  degC
    return float(b[0] - 40)


def _maf(b: list[int]) -> Optional[float]:
    # PID 10: ((A*256)+B)/100  grams/sec
    return ((b[0] << 8) + b[1]) / 100.0


def _throttle(b: list[int]) -> Optional[float]:
    # PID 11: A*100/255  percent
    return b[0] * 100.0 / 255.0


def _o2_voltage(b: list[int]) -> Optional[float]:
    # PID 14 (Bank 1, Sensor 1): A/200  volts. (B is short-term fuel trim; unused.)
    # NOTE: a wideband sensor reports different data -- do not relabel it as this.
    return b[0] / 200.0


# Field order here defines the canonical six readings used everywhere.
PIDS: list[PidSpec] = [
    PidSpec("0C", "rpm", 2, "rpm", _rpm),
    PidSpec("0D", "speed_kmh", 1, "km/h", _speed),
    PidSpec("05", "coolant_c", 1, "degC", _coolant),
    PidSpec("10", "maf_g_s", 2, "g/s", _maf),
    PidSpec("11", "throttle_pct", 1, "%", _throttle),
    PidSpec("14", "o2_v", 2, "V", _o2_voltage),
]

FIELDS: list[str] = [p.field for p in PIDS]
_BY_PID = {p.pid.upper(): p for p in PIDS}
_BY_FIELD = {p.field: p for p in PIDS}


def field_unit(field_name: str) -> str:
    spec = _BY_FIELD.get(field_name)
    return spec.unit if spec else ""


@dataclass
class DecodeResult:
    seq: Optional[int] = None
    uptime_ms: Optional[int] = None
    # field -> decoded value (only for PIDs that produced a valid sample this frame)
    values: dict[str, float] = field(default_factory=dict)
    # fields the ECU/firmware reported as unsupported this frame
    unsupported: set[str] = field(default_factory=set)
    # number of per-PID decode problems (bad hex, wrong byte count, unknown PID)
    decode_errors: int = 0


class RawFrameError(ValueError):
    """Raised when a line is not a usable raw OBD frame (bad JSON handled upstream)."""


def _hex_to_bytes(s: str) -> list[int]:
    s = s.strip()
    if len(s) % 2 != 0:
        raise ValueError("odd hex length")
    try:
        return [int(s[i : i + 2], 16) for i in range(0, len(s), 2)]
    except ValueError as exc:
        raise ValueError(f"bad hex: {s!r}") from exc


def parse_raw_frame(obj: dict) -> DecodeResult:
    """Validate and decode one already-JSON-parsed raw frame object.

    Raises RawFrameError for structural problems (wrong type/version/shape).
    Per-PID issues are counted in ``decode_errors`` and otherwise skipped, so one
    bad PID never discards a whole frame.
    """
    if not isinstance(obj, dict):
        raise RawFrameError("frame is not an object")
    if obj.get("type") != RAW_TYPE:
        raise RawFrameError(f"unexpected type {obj.get('type')!r}")
    if obj.get("v") != RAW_VERSION:
        raise RawFrameError(f"unsupported raw schema version {obj.get('v')!r}")

    result = DecodeResult()

    seq = obj.get("seq")
    if isinstance(seq, int) and seq >= 0:
        result.seq = seq
    uptime = obj.get("uptime_ms")
    if isinstance(uptime, int) and uptime >= 0:
        result.uptime_ms = uptime

    pids = obj.get("pids", {})
    if not isinstance(pids, dict):
        raise RawFrameError("'pids' is not an object")

    for pid_hex, raw_hex in pids.items():
        spec = _BY_PID.get(str(pid_hex).upper())
        if spec is None:
            # Unknown PID: not fatal, just not one of our six. Count and move on.
            result.decode_errors += 1
            continue
        if not isinstance(raw_hex, str):
            result.decode_errors += 1
            continue
        try:
            data = _hex_to_bytes(raw_hex)
        except ValueError:
            result.decode_errors += 1
            continue
        if len(data) < spec.n_bytes:
            result.decode_errors += 1
            continue
        try:
            value = spec.decode(data[: spec.n_bytes])
        except Exception:
            result.decode_errors += 1
            continue
        if value is None:
            result.decode_errors += 1
            continue
        result.values[spec.field] = float(value)

    unsupported = obj.get("unsupported", [])
    if isinstance(unsupported, list):
        for pid_hex in unsupported:
            spec = _BY_PID.get(str(pid_hex).upper())
            if spec is not None:
                result.unsupported.add(spec.field)

    return result


@dataclass
class DtcResult:
    responded: int = 0              # ECUs that answered the Mode 03 request
    codes: list[str] = field(default_factory=list)  # decoded, de-duplicated, e.g. "P0301"
    decode_errors: int = 0


def decode_dtc(raw_hex: str) -> str:
    """Two raw DTC bytes as hex -> SAE J2012 code, e.g. "0301" -> "P0301", "C035" -> "U0035"."""
    a, b = _hex_to_bytes(raw_hex)  # ValueError unless exactly two bytes
    return f"{_DTC_SYSTEMS[a >> 6]}{(a >> 4) & 0x3}{a & 0xF:X}{b:02X}"


def parse_dtc_frame(obj: dict) -> DtcResult:
    """Validate and decode one already-JSON-parsed trouble-code line."""
    if obj.get("v") != RAW_VERSION:
        raise RawFrameError(f"unsupported dtc schema version {obj.get('v')!r}")
    responded = obj.get("responded")
    if not isinstance(responded, int) or responded < 0:
        raise RawFrameError("'responded' is not a non-negative integer")
    codes = obj.get("codes", [])
    if not isinstance(codes, list):
        raise RawFrameError("'codes' is not a list")

    result = DtcResult(responded=responded)
    for raw_hex in codes:
        try:
            code = decode_dtc(str(raw_hex))
        except ValueError:
            result.decode_errors += 1
            continue
        if code not in result.codes:
            result.codes.append(code)
    return result
