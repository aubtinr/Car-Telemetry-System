"""FastAPI app: REST + WebSocket, serving the built React UI from one local origin.

Endpoints (handoff section 5):
  GET  /              -> the built React app (when backend/static exists)
  GET  /api/health    -> mode, serial connection, last frame age, error counters
  GET  /api/latest    -> most recent telemetry envelope (for initial page load)
  WS   /ws/telemetry  -> latest envelope on connect, each new snapshot, and a
                         status refresh at least once per second

Only the latest snapshot is ever kept pending (no unbounded queue): a slow client
simply misses intermediate frames, it does not build backpressure.
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import config
from .mock import MockSource
from .serial_reader import SerialSource
from .state import TelemetryEngine


class Hub:
    """Owns the engine, the active source, and the set of WebSocket clients."""

    def __init__(self) -> None:
        self.engine = TelemetryEngine()
        self.source = None
        self.clients: set[WebSocket] = set()
        self._frame_counter = 0  # bumped (from the source thread) on each new frame
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task | None = None

    def on_frame(self) -> None:
        # Called from the serial/mock thread. Int increment is atomic under the GIL.
        self._frame_counter += 1

    def start_source(self) -> None:
        if config.mock:
            self.source = MockSource(self.engine, self.on_frame)
        else:
            self.source = SerialSource(self.engine, self.on_frame)
        self.source.start()

    def latest_envelope(self) -> dict:
        connected = bool(self.source and self.source.connected)
        mode = self.source.mode if self.source else ("mock" if config.mock else "live")
        return self.engine.build_envelope(mode, connected)

    async def broadcast_loop(self) -> None:
        last_sent = 0.0
        last_counter = -1
        while True:
            await asyncio.sleep(0.05)
            now = asyncio.get_event_loop().time()
            new_frame = self._frame_counter != last_counter
            heartbeat_due = (now - last_sent) >= config.heartbeat_s
            if not (new_frame or heartbeat_due):
                continue
            if not self.clients:
                last_counter = self._frame_counter
                last_sent = now
                continue
            env = self.latest_envelope()
            await self._send_all(env)
            last_counter = self._frame_counter
            last_sent = now

    async def _send_all(self, env: dict) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(env)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


@asynccontextmanager
async def lifespan(app: FastAPI):
    hub._loop = asyncio.get_event_loop()
    hub.start_source()
    hub._task = asyncio.create_task(hub.broadcast_loop())
    try:
        yield
    finally:
        if hub._task:
            hub._task.cancel()
        if hub.source:
            hub.source.stop()


app = FastAPI(title="Car Telemetry Backend", version="1.0", lifespan=lifespan)


@app.get("/api/health")
async def health() -> JSONResponse:
    connected = bool(hub.source and hub.source.connected)
    mode = hub.source.mode if hub.source else ("mock" if config.mock else "live")
    return JSONResponse(hub.engine.health(mode, connected))


@app.get("/api/latest")
async def latest() -> JSONResponse:
    return JSONResponse(hub.latest_envelope())


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    hub.clients.add(ws)
    try:
        # Send the current state immediately on connect.
        await ws.send_json(hub.latest_envelope())
        # The client does not send anything in v1; just keep the socket open.
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        hub.clients.discard(ws)


# ---- Serve the built React app (if present) from the same origin -----------

_index_fallback = """<!doctype html><html><head><meta charset="utf-8">
<title>Car Telemetry</title></head><body style="font-family:sans-serif;padding:2rem">
<h1>Car Telemetry backend is running</h1>
<p>The built React UI was not found at <code>backend/static/</code>.</p>
<p>During development, run the Vite dev server in <code>frontend/</code>
(<code>npm run dev</code>) — it proxies the API and WebSocket here.</p>
<p>For production, build the frontend and copy <code>frontend/dist</code> to
<code>backend/static</code>, then reload this page.</p>
<ul>
<li><a href="/api/health">/api/health</a></li>
<li><a href="/api/latest">/api/latest</a></li>
</ul></body></html>"""

if os.path.isdir(config.static_dir) and os.path.isfile(os.path.join(config.static_dir, "index.html")):
    app.mount("/", StaticFiles(directory=config.static_dir, html=True), name="static")
else:
    @app.get("/")
    async def index() -> HTMLResponse:
        return HTMLResponse(_index_fallback)
