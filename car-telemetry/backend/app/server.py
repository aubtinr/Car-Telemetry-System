"""FastAPI app: REST + WebSocket, serving the built React UI from one local origin.

Endpoints (handoff section 5):
  GET  /              -> the built React app (when backend/static exists)
  GET  /api/health    -> mode, serial connection, last frame age, error counters
  GET  /api/latest    -> most recent telemetry envelope (for initial page load)
  GET  /api/laps                      -> saved laps (newest first) with summaries
  POST /api/laps/start, /api/laps/stop -> start / stop recording (409 if not allowed)
  GET  /api/laps/{id}                 -> one lap with (thinned) samples for charts
  DELETE /api/laps/{id}               -> remove a saved lap
  WS   /ws/telemetry  -> latest envelope on connect, each new snapshot (pushed as
                         soon as it arrives), and a status refresh at least once
                         per second

Only the latest snapshot is ever kept pending (no unbounded queue): frames that
arrive while a send is in progress collapse into one, so a slow client misses
intermediate frames instead of building backpressure.
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import config
from .laps import LapError, LapRecorder
from .mock import MockSource
from .serial_reader import SerialSource
from .state import TelemetryEngine


class Hub:
    """Owns the engine, the active source, and the set of WebSocket clients."""

    def __init__(self) -> None:
        self.engine = TelemetryEngine()
        self.recorder = LapRecorder(config.lap_db_path, "mock" if config.mock else "live")
        self.engine.recorder = self.recorder
        self.source = None
        self.clients: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._wake: asyncio.Event | None = None  # set on each new frame
        self._task: asyncio.Task | None = None

    def on_frame(self) -> None:
        # Called from the serial/mock thread: wake the broadcaster right away.
        if self._loop is not None and self._wake is not None:
            self._loop.call_soon_threadsafe(self._wake.set)

    def start_source(self) -> None:
        if config.mock:
            self.source = MockSource(self.engine, self.on_frame)
        else:
            self.source = SerialSource(self.engine, self.on_frame)
        self.source.start()

    def latest_envelope(self) -> dict:
        connected = bool(self.source and self.source.connected)
        mode = self.source.mode if self.source else ("mock" if config.mock else "live")
        env = self.engine.build_envelope(mode, connected)
        env["lap"] = self.recorder.status()
        return env

    def poke(self) -> None:
        # From the event loop: push an update now (e.g. after a lap starts/stops).
        if self._wake is not None:
            self._wake.set()

    async def broadcast_loop(self) -> None:
        # Send as soon as a frame arrives, or after heartbeat_s of silence.
        assert self._wake is not None
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=config.heartbeat_s)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()
            if self.clients:
                await self._send_all(self.latest_envelope())

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
    hub._wake = asyncio.Event()
    hub.start_source()
    hub._task = asyncio.create_task(hub.broadcast_loop())
    try:
        yield
    finally:
        if hub._task:
            hub._task.cancel()
        if hub.source:
            hub.source.stop()
        hub.recorder.shutdown()


app = FastAPI(title="Car Telemetry Backend", version="1.0", lifespan=lifespan)


@app.get("/api/health")
async def health() -> JSONResponse:
    connected = bool(hub.source and hub.source.connected)
    mode = hub.source.mode if hub.source else ("mock" if config.mock else "live")
    return JSONResponse(hub.engine.health(mode, connected))


@app.get("/api/latest")
async def latest() -> JSONResponse:
    return JSONResponse(hub.latest_envelope())


@app.get("/api/laps")
async def laps_list() -> JSONResponse:
    return JSONResponse(hub.recorder.list_laps())


@app.post("/api/laps/start")
async def lap_start() -> JSONResponse:
    try:
        status = hub.recorder.start()
    except LapError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    hub.poke()
    return JSONResponse(status)


@app.post("/api/laps/stop")
async def lap_stop() -> JSONResponse:
    try:
        lap = hub.recorder.stop()
    except LapError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    hub.poke()
    return JSONResponse(lap)


@app.get("/api/laps/{lap_id}")
async def lap_get(lap_id: int) -> JSONResponse:
    lap = hub.recorder.get(lap_id)
    if lap is None:
        return JSONResponse({"error": "lap not found"}, status_code=404)
    return JSONResponse(lap)


@app.delete("/api/laps/{lap_id}")
async def lap_delete(lap_id: int) -> JSONResponse:
    try:
        deleted = hub.recorder.delete(lap_id)
    except LapError as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    if not deleted:
        return JSONResponse({"error": "lap not found"}, status_code=404)
    return JSONResponse({"deleted": lap_id})


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
