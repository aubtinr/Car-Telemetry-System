// REST calls for lap recording. The backend owns the recording; the UI only
// starts/stops it and reads saved laps back.

import type { LapDetail, LapRecord } from "../types/telemetry";

async function call<T>(method: string, path: string): Promise<T> {
  const res = await fetch(path, { method });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `request failed (${res.status})`);
  return body as T;
}

export const startLap = () => call<unknown>("POST", "/api/laps/start");
export const stopLap = () => call<LapRecord>("POST", "/api/laps/stop");
export const listLaps = () => call<LapRecord[]>("GET", "/api/laps");
export const getLap = (id: number) => call<LapDetail>("GET", `/api/laps/${id}`);
export const deleteLap = (id: number) => call<unknown>("DELETE", `/api/laps/${id}`);

// "1:05.3" under an hour, "1:02:05" above.
export function fmtDuration(ms: number | null, tenths = true): string {
  if (ms === null) return "—";
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(Math.floor(s))}`;
  return `${m}:${tenths ? s.toFixed(1).padStart(4, "0") : pad(Math.floor(s))}`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
