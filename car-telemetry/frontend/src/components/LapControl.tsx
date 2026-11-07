// Start / Stop lap button for the status bar. While recording it shows the
// running time and distance. The backend does the recording, so a lap keeps
// going even if this page reloads.

import { useState } from "react";
import { useTelemetry } from "../transport/useTelemetry";
import { fmtDuration, startLap, stopLap } from "../lib/lapsApi";
import { fmtDistance, type UnitSystem } from "../lib/units";
import type { LapRecord } from "../types/telemetry";

interface Props {
  system: UnitSystem;
  onStopped: (lap: LapRecord) => void;
}

export function LapControl({ system, onStopped }: Props) {
  const t = useTelemetry();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
    }
  };

  if (t.lap.active) {
    return (
      <div className="lap-control recording">
        <span className="rec-dot" aria-hidden />
        <span className="lap-time">{fmtDuration(t.lap.elapsedMs)}</span>
        <span className="lap-dist">{fmtDistance(t.lap.distanceKm, system)}</span>
        <button
          className="lap-btn stop"
          disabled={busy}
          onClick={() => run(async () => onStopped(await stopLap()))}
        >
          Stop lap
        </button>
        {error && <span className="lap-error">{error}</span>}
      </div>
    );
  }

  const unavailable = t.isMockTransport || !t.connected;
  return (
    <div className="lap-control">
      <button
        className="lap-btn start"
        disabled={busy || unavailable}
        title={unavailable ? "Lap recording needs the backend" : undefined}
        onClick={() => run(async () => void (await startLap()))}
      >
        ● Start lap
      </button>
      {error && <span className="lap-error">{error}</span>}
    </div>
  );
}
