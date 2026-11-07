"""Runtime configuration, read from environment variables.

Nothing here is hard-coded to one machine: the serial port name changes between
boots and between a laptop and the Pi (see the handoff, section 2), so it is an
env var, and mock mode lets the whole stack run with no hardware at all.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    # --- HTTP server ---
    host: str = os.environ.get("TELEM_HOST", "0.0.0.0")
    port: int = _env_int("TELEM_PORT", 8000)

    # --- Serial link to the STM32 (via the onboard ST-LINK USB virtual COM port) ---
    # Prefer a stable /dev/serial/by-id/... path on the Pi; /dev/ttyACM0 is a common
    # fallback. On Windows this looks like "COM5", on macOS "/dev/tty.usbmodemXXXX".
    serial_port: str = os.environ.get("TELEM_SERIAL_PORT", "/dev/ttyACM0")
    serial_baud: int = _env_int("TELEM_SERIAL_BAUD", 115200)

    # --- Mock mode ---
    # When true, no serial port is opened; synthetic *raw* STM frames are generated
    # and pushed through the exact same decode + state pipeline as real hardware.
    # Defaults to True so a fresh checkout runs on a laptop with zero hardware.
    mock: bool = _env_bool("TELEM_MOCK", True)
    # "drive"  -> a calm, plausible healthy drive (nice for a first look / demo)
    # "cycle"  -> rotates through the required test scenarios (unplug, stale PID,
    #             unsupported sensor, null-initial, reconnect) so the UI can be
    #             verified against each state.
    mock_scenario: str = os.environ.get("TELEM_MOCK_SCENARIO", "drive")

    # --- Freshness thresholds (milliseconds) ---
    # A frame with only old PID values must NOT count as fresh vehicle data, and the
    # STM link itself is considered down if no valid frame arrives for this long.
    stm_link_timeout_ms: int = _env_int("TELEM_STM_LINK_TIMEOUT_MS", 2000)
    stale_default_ms: int = _env_int("TELEM_STALE_DEFAULT_MS", 2000)
    stale_coolant_ms: int = _env_int("TELEM_STALE_COOLANT_MS", 5000)
    # Trouble codes are checked every ~5 s; older than this => shown as stale.
    dtc_stale_ms: int = _env_int("TELEM_DTC_STALE_MS", 15000)

    # --- Serial framing guard (handoff: keep each line under 2048 bytes) ---
    max_line_bytes: int = _env_int("TELEM_MAX_LINE_BYTES", 2048)

    # --- Status heartbeat: push a status refresh at least this often (seconds) ---
    heartbeat_s: float = float(_env_int("TELEM_HEARTBEAT_MS", 1000)) / 1000.0

    # SQLite file holding recorded laps. Created on first run.
    lap_db_path: str = os.environ.get(
        "TELEM_LAP_DB",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "laps.sqlite3"),
    )

    # Directory holding the built React app (served at "/"). Optional.
    static_dir: str = os.environ.get(
        "TELEM_STATIC_DIR",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "static"),
    )


config = Config()
