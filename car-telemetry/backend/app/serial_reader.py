"""Serial source: own the USB serial port, frame NDJSON lines, feed the engine.

Runs on a dedicated thread so a blocking serial read can never freeze the async
server (handoff section 5). Handles the realities called out in the doc:
  - a USB read is NOT one JSON message: reads may split or combine lines,
  - enforce the byte cap while buffering; discard oversized data through the next LF,
  - trim a trailing CR,
  - on read failure / unplug: close, mark disconnected, retry ~1x/second,
  - never crash the reader on bad input.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

try:
    import serial  # pyserial
except Exception:  # pragma: no cover - only needed in live mode
    serial = None  # type: ignore

from .config import config
from .state import TelemetryEngine

LF = 0x0A
CR = 0x0D


class SerialSource:
    def __init__(self, engine: TelemetryEngine, on_frame: Callable[[], None]) -> None:
        self.engine = engine
        self._on_frame = on_frame
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def mode(self) -> str:
        return "live"

    def start(self) -> None:
        if serial is None:
            raise RuntimeError(
                "pyserial is not installed but live mode was requested. "
                "Install requirements or set TELEM_MOCK=1."
            )
        self._thread = threading.Thread(target=self._run, name="serial-reader", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)

    def _run(self) -> None:
        while not self._stop.is_set():
            port = None
            try:
                port = serial.Serial(
                    config.serial_port,
                    config.serial_baud,
                    bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE,
                    stopbits=serial.STOPBITS_ONE,
                    timeout=1.0,
                )
                self._connected = True
                self.engine.reset_stream_state()
                self._read_loop(port)
            except Exception:
                # open failed or the device vanished mid-read.
                self._connected = False
                time.sleep(1.0)  # retry about once per second
            finally:
                if port is not None:
                    try:
                        port.close()
                    except Exception:
                        pass
                self._connected = False

    def _read_loop(self, port) -> None:
        buf = bytearray()
        discarding = False  # true while skipping an oversized line until the next LF
        while not self._stop.is_set():
            chunk = port.read(512)  # returns b"" on timeout
            if chunk == b"":
                continue
            for byte in chunk:
                if byte == LF:
                    if discarding:
                        discarding = False
                        buf.clear()
                        continue
                    if buf and buf[-1] == CR:
                        buf.pop()
                    if buf:
                        line = bytes(buf).decode("utf-8", errors="replace")
                        if self.engine.ingest_line(line):
                            self._on_frame()
                    buf.clear()
                else:
                    if discarding:
                        continue
                    buf.append(byte)
                    if len(buf) > config.max_line_bytes:
                        # Oversized: drop everything up to the next LF.
                        self.engine.note_oversize()
                        buf.clear()
                        discarding = True
