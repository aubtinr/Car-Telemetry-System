"""Lap recording: everything between Start and Stop is saved to SQLite.

Each sample is the decoded values of one raw frame (only the PIDs that answered
that frame; the rest are NULL), timed from lap start. Samples are flushed to disk
about once a second, so a power cut loses at most ~1 s, and a lap left open by a
crash or power loss is closed (and marked "recovered") on the next startup.

Summary metrics (per-field min/max/avg, distance from integrated speed, trouble
codes seen) are kept as running totals, so Stop is instant even for long laps.
"""
from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from .obd import FIELDS

log = logging.getLogger(__name__)

FLUSH_S = 1.0
MAX_SPEED_GAP_S = 2.0       # don't integrate distance across a link outage
MAX_DETAIL_POINTS = 1500    # samples returned per lap for charting

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS laps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_s REAL,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS samples (
  lap_id INTEGER NOT NULL,
  t_ms INTEGER NOT NULL,
  {", ".join(f"{f} REAL" for f in FIELDS)}
);
CREATE INDEX IF NOT EXISTS samples_lap ON samples (lap_id, t_ms);
"""


class LapError(Exception):
    """A lap action that doesn't fit the current state (e.g. Stop with no lap running)."""


def _utc_iso(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _parse_utc(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


class LapStats:
    """Running per-field min/max/avg, distance, and trouble codes for one lap."""

    def __init__(self) -> None:
        self._min: dict[str, Optional[float]] = {f: None for f in FIELDS}
        self._max: dict[str, Optional[float]] = {f: None for f in FIELDS}
        self._sum: dict[str, float] = {f: 0.0 for f in FIELDS}
        self._n: dict[str, int] = {f: 0 for f in FIELDS}
        self.distance_km = 0.0
        self.codes: list[str] = []
        self._last_speed: Optional[tuple[float, float]] = None  # (t_s, km/h)

    def add(self, t_s: float, values: dict[str, Optional[float]]) -> None:
        for f, v in values.items():
            if v is None or f not in self._n:
                continue
            self._min[f] = v if self._min[f] is None else min(self._min[f], v)
            self._max[f] = v if self._max[f] is None else max(self._max[f], v)
            self._sum[f] += v
            self._n[f] += 1

        speed = values.get("speed_kmh")
        if speed is not None:
            if self._last_speed is not None:
                t0, v0 = self._last_speed
                dt = t_s - t0
                if 0 < dt <= MAX_SPEED_GAP_S:
                    self.distance_km += (v0 + speed) / 2.0 * dt / 3600.0
            self._last_speed = (t_s, speed)

    def add_codes(self, codes: list[str]) -> None:
        for c in codes:
            if c not in self.codes:
                self.codes.append(c)

    def to_dict(self) -> dict:
        fields = {}
        for f in FIELDS:
            n = self._n[f]
            fields[f] = {
                "min": _round(self._min[f]),
                "max": _round(self._max[f]),
                "avg": _round(self._sum[f] / n) if n else None,
            }
        return {
            "fields": fields,
            "distance_km": round(self.distance_km, 3),
            "codes": list(self.codes),
        }


class LapRecorder:
    """Owns the lap database. Called from the serial thread and the async server."""

    def __init__(self, path: str, mode: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)
        self._lock = threading.RLock()
        self._mode = mode  # "live" or "mock", stored on each lap

        self._lap_id: Optional[int] = None
        self._t0 = 0.0  # monotonic seconds at lap start
        self._started_at: Optional[str] = None
        self._stats: Optional[LapStats] = None
        self._buf: list[tuple] = []
        self._last_flush = 0.0

        self._close_abandoned()

    # ---- recording ---------------------------------------------------------

    def start(self) -> dict:
        with self._lock:
            if self._lap_id is not None:
                raise LapError("a lap is already running")
            started_at = _utc_iso()
            cur = self._db.execute(
                "INSERT INTO laps (mode, started_at) VALUES (?, ?)", (self._mode, started_at)
            )
            self._db.commit()
            self._lap_id = cur.lastrowid
            self._t0 = time.monotonic()
            self._last_flush = self._t0
            self._started_at = started_at
            self._stats = LapStats()
            self._buf = []
            return self._status_locked()

    def stop(self) -> dict:
        with self._lock:
            if self._lap_id is None or self._stats is None:
                raise LapError("no lap is running")
            self._flush_locked()
            lap_id = self._lap_id
            self._finish_locked(lap_id, _utc_iso(), time.monotonic() - self._t0, self._stats)
            self._lap_id = None
            self._stats = None
            lap = self.get(lap_id, with_samples=False)
        assert lap is not None
        return lap

    def add_sample(self, values: dict[str, float]) -> None:
        """One decoded frame. Cheap no-op when no lap is running."""
        if self._lap_id is None or not values:
            return
        with self._lock:
            if self._lap_id is None or self._stats is None:
                return
            now = time.monotonic()
            t_s = now - self._t0
            self._stats.add(t_s, values)
            self._buf.append(
                (self._lap_id, int(round(t_s * 1000)), *[values.get(f) for f in FIELDS])
            )
            if now - self._last_flush >= FLUSH_S:
                self._flush_locked()
                self._last_flush = now

    def add_codes(self, codes: list[str]) -> None:
        if self._lap_id is None or not codes:
            return
        with self._lock:
            if self._stats is not None:
                self._stats.add_codes(codes)

    def status(self) -> dict:
        with self._lock:
            return self._status_locked()

    def shutdown(self) -> None:
        """Save a running lap and close the database (server shutdown)."""
        with self._lock:
            if self._lap_id is not None:
                try:
                    self.stop()
                except (LapError, sqlite3.Error):
                    log.exception("could not save the running lap on shutdown")
            self._db.close()

    # ---- reading -------------------------------------------------------------

    def list_laps(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM laps WHERE ended_at IS NOT NULL ORDER BY id DESC"
            ).fetchall()
        return [_lap_row(r) for r in rows]

    def get(self, lap_id: int, with_samples: bool = True) -> Optional[dict]:
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM laps WHERE id = ? AND ended_at IS NOT NULL", (lap_id,)
            ).fetchone()
            if row is None:
                return None
            lap = _lap_row(row)
            if not with_samples:
                return lap
            rows = self._db.execute(
                f"SELECT t_ms, {', '.join(FIELDS)} FROM samples WHERE lap_id = ? ORDER BY t_ms",
                (lap_id,),
            ).fetchall()

        # Evenly thin long laps for charting; the summary keeps the true min/max.
        step = max(1, math.ceil(len(rows) / MAX_DETAIL_POINTS))
        kept = rows[::step]
        samples: dict[str, list] = {"t_ms": [r["t_ms"] for r in kept]}
        for f in FIELDS:
            samples[f] = [r[f] for r in kept]
        lap["sample_count"] = len(rows)
        lap["samples"] = samples
        return lap

    def delete(self, lap_id: int) -> bool:
        with self._lock:
            if lap_id == self._lap_id:
                raise LapError("can't delete the lap that is recording")
            cur = self._db.execute("DELETE FROM laps WHERE id = ?", (lap_id,))
            self._db.execute("DELETE FROM samples WHERE lap_id = ?", (lap_id,))
            self._db.commit()
            return cur.rowcount > 0

    # ---- internals -------------------------------------------------------------

    def _status_locked(self) -> dict:
        if self._lap_id is None or self._stats is None:
            return {
                "active": False,
                "id": None,
                "started_at": None,
                "elapsed_ms": None,
                "distance_km": None,
            }
        return {
            "active": True,
            "id": self._lap_id,
            "started_at": self._started_at,
            "elapsed_ms": int((time.monotonic() - self._t0) * 1000),
            "distance_km": round(self._stats.distance_km, 3),
        }

    def _flush_locked(self) -> None:
        if not self._buf:
            return
        placeholders = ", ".join("?" for _ in range(2 + len(FIELDS)))
        try:
            self._db.executemany(
                f"INSERT INTO samples (lap_id, t_ms, {', '.join(FIELDS)}) VALUES ({placeholders})",
                self._buf,
            )
            self._db.commit()
        except sqlite3.Error:
            # Never let a disk problem take down the serial reader; drop this batch.
            log.exception("failed to write %d lap samples", len(self._buf))
        self._buf = []

    def _finish_locked(self, lap_id: int, ended_at: str, duration_s: float, stats: LapStats,
                       recovered: bool = False) -> None:
        summary = stats.to_dict()
        if recovered:
            summary["recovered"] = True
        self._db.execute(
            "UPDATE laps SET ended_at = ?, duration_s = ?, summary = ? WHERE id = ?",
            (ended_at, round(duration_s, 3), json.dumps(summary), lap_id),
        )
        self._db.commit()

    def _close_abandoned(self) -> None:
        """Close laps left open by a crash/power loss, rebuilding their summary."""
        with self._lock:
            open_laps = self._db.execute(
                "SELECT id, started_at FROM laps WHERE ended_at IS NULL"
            ).fetchall()
            for lap in open_laps:
                stats = LapStats()
                last_t_ms = 0
                for r in self._db.execute(
                    f"SELECT t_ms, {', '.join(FIELDS)} FROM samples WHERE lap_id = ? ORDER BY t_ms",
                    (lap["id"],),
                ):
                    last_t_ms = r["t_ms"]
                    stats.add(r["t_ms"] / 1000.0, {f: r[f] for f in FIELDS})
                duration_s = last_t_ms / 1000.0
                ended_at = _utc_iso(_parse_utc(lap["started_at"]) + timedelta(seconds=duration_s))
                self._finish_locked(lap["id"], ended_at, duration_s, stats, recovered=True)
                log.warning("recovered unfinished lap %s (%.1f s)", lap["id"], duration_s)


def _lap_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "mode": row["mode"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "duration_s": row["duration_s"],
        "summary": json.loads(row["summary"]) if row["summary"] else None,
    }


def _round(v: Optional[float]) -> Optional[float]:
    return None if v is None else round(v, 3)
