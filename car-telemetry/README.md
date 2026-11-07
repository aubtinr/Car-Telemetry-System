# Car Telemetry — STM32 → Pi → React

Reads OBD-II telemetry that a NUCLEO-F446RE forwards over USB serial, decodes it on
the Raspberry Pi, and shows it on a React gauge dashboard. Built to the handoff spec,
with one agreed change: **the STM32 sends raw, untranslated OBD-II values and the Pi
applies the standard OBD-II formulas** (see `docs/raw-frame-contract.md`).

```
STM32 (raw OBD bytes over USART2→ST-LINK USB)
        │  newline-delimited JSON, 115200 8N1
        ▼
Python backend  (serial reader → OBD decode → freshness/state → WebSocket)
        │  /ws/telemetry  (+ /api/health, /api/latest)
        ▼
React dashboard (Speed + RPM gauges, 4 tiles, unit toggle, 60s trend)
```

## What works today

- **Runs with no hardware.** Mock mode synthesizes *raw* STM frames and pushes them
  through the real decoder + state machine, so the whole stack runs on a laptop.
- Decode layer for the six PIDs (rpm, speed, coolant, MAF, throttle, O₂ B1S1).
- Stored trouble codes (Mode 03) checked every 5 s, shown in an always-visible
  panel ("No codes" / the code list / "No response from ECU") plus an alert banner.
- Freshness tracking: per-field age, stale flags (2 s default / 5 s coolant), STM
  link fresh/stale/disconnected, sequence-gap and STM-reboot detection, error counters.
- Robust serial framing: split/combined reads, oversized-line recovery, bad-JSON
  recovery, auto-reconnect on unplug (~1 Hz).
- UI: large Speed + RPM gauges, coolant/throttle/MAF/O₂ tiles, a selectable 60 s
  trend line, explicit connection indicators, and a visible MOCK badge that never
  silently replaces live data.
- Lap recording: **Start lap / Stop lap** in the top bar. Every frame in between is
  saved to SQLite on the Pi (`backend/data/laps.sqlite3`) with a summary (duration,
  distance, per-metric min/avg/max, trouble codes seen). Saved laps are under
  **Menu → Saved laps**, each with a full-lap chart. A lap cut off by a crash or
  power loss is closed and marked "recovered" on the next start (≤ ~1 s lost).
- Menu: layout (Auto / Landscape / Portrait), color theme (Midnight, Daylight,
  Ember, Track, Night), and units, remembered per browser.

## Quick start (laptop, no hardware)

Two terminals.

**Backend (mock mode is the default):**
```bash
cd backend
python3 -m pip install -r requirements.txt       # first time
python3 run.py                                    # serves on http://localhost:8000
```

**Frontend (dev server with hot reload, proxies to the backend):**
```bash
cd frontend
npm install                                       # first time
npm run dev                                        # http://localhost:5173
```

Open **http://localhost:5173**. You'll see a live mock drive.

- Want to see the failure states? Start the backend with
  `TELEM_MOCK_SCENARIO=cycle python3 run.py` — it rotates through normal → stale
  coolant → unsupported O₂ → unplugged → reconnect every 8 s (trouble codes
  appear during stale coolant / unsupported O₂).
- Want the UI with *no backend at all*? Open **http://localhost:5173/?mock=1**
  (client-side mock; labeled "UI MOCK").

## Single-origin / production build

Build the UI and let the backend serve it (this is how it runs on the Pi, and what
Chromium kiosk points at):

```bash
./scripts/build_frontend.sh      # builds frontend/ and copies dist → backend/static
cd backend && python3 run.py     # now http://localhost:8000 serves the UI + API + WS
```

## Running against real hardware

1. Wire the NUCLEO to the Pi per the handoff (USB A→Mini-B to the ST-LINK CN1).
2. Find the port: `ls /dev/serial/by-id/` (preferred) or expect `/dev/ttyACM0`.
3. Make sure your user is in the `dialout` group and no other serial monitor is open.
4. Start the backend in live mode:
   ```bash
   cd backend
   TELEM_MOCK=0 TELEM_SERIAL_PORT=/dev/serial/by-id/usb-STMicro...-if00 python3 run.py
   ```
   (or copy `backend/.env.example` to `.env` and edit it).

The firmware must emit the raw frame in `docs/raw-frame-contract.md`. Confirm that
contract with the firmware author; if the real byte layout differs, the only file to
change is `backend/app/obd.py`.

## Configuration (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `TELEM_MOCK` | `1` | `1` = synthetic raw frames, `0` = open the real serial port |
| `TELEM_MOCK_SCENARIO` | `drive` | `drive` (calm demo) or `cycle` (rotate test states) |
| `TELEM_SERIAL_PORT` | `/dev/ttyACM0` | Serial device (live mode) |
| `TELEM_SERIAL_BAUD` | `115200` | Baud (8N1) |
| `TELEM_PORT` | `8000` | HTTP/WS port |
| `TELEM_STM_LINK_TIMEOUT_MS` | `2000` | No valid frame for this long → link stale |
| `TELEM_STALE_DEFAULT_MS` | `2000` | Per-field stale threshold (coolant uses 5000) |
| `TELEM_DTC_STALE_MS` | `15000` | Trouble-code check older than this → shown as stale |
| `TELEM_LAP_DB` | `backend/data/laps.sqlite3` | Where recorded laps are stored |

## Layout

```
backend/   FastAPI + serial reader + OBD decode + state machine (+ mock)
  app/obd.py       ← the raw→units translation (revisit with firmware author)
  app/state.py     ← freshness, support, seq/reboot tracking, envelope assembly
  app/laps.py      ← lap recording + summaries (SQLite)
  app/serial_reader.py / mock.py / server.py / config.py
frontend/  React + TypeScript + Vite
  src/transport/   ← WebSocket client (+ client mock), aging, history
  src/components/  ← Gauge, MetricTile, StatusBar, TrendChart, Dashboard
docs/      raw-frame-contract.md (STM→Pi schema)
deploy/    systemd unit + Chromium kiosk notes (for the Pi)
scripts/   build_frontend.sh
```

## Deferred to later (by design)

Final theme/colors/gauge styling, CSV logging, DTCs, Pi auto-start wiring beyond the
sample unit in `deploy/`, and car-power integration. The current look is a clean,
functional placeholder.
