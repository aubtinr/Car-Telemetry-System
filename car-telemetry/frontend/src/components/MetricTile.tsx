// Compact readout tile for the secondary metrics (coolant, throttle, MAF, O2).

import type { FieldName, FieldState } from "../types/telemetry";
import { fieldLabel, toDisplay, type UnitSystem } from "../lib/units";

interface Props {
  field: FieldName;
  state: FieldState;
  system: UnitSystem;
}

export function MetricTile({ field, state, system }: Props) {
  const d = toDisplay(field, state.value, system);
  const unsupported = state.supported === false;
  const noData = !unsupported && state.value === null;
  const stale = state.stale && !unsupported && !noData;

  const statusClass = unsupported ? "unsupported" : noData ? "nodata" : stale ? "stale" : "fresh";
  const frac = unsupported || noData ? 0 : (d.fraction ?? 0);

  let badge: string;
  if (unsupported) badge = "UNSUPPORTED";
  else if (noData) badge = "NO DATA";
  else if (stale) badge = `STALE · ${fmtAge(state.ageMs)}`;
  else badge = "LIVE";

  return (
    <div className={`tile ${statusClass}`}>
      <div className="tile-label">{fieldLabel(field)}</div>
      <div className="tile-value-row">
        <span className="tile-value">{unsupported ? "N/A" : d.value}</span>
        {!unsupported && !noData && <span className="tile-unit">{d.unit}</span>}
      </div>
      <div className="tile-bar">
        <div className="tile-bar-fill" style={{ width: `${Math.round(frac * 100)}%` }} />
      </div>
      <div className={`tile-badge ${statusClass}`}>{badge}</div>
    </div>
  );
}

function fmtAge(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
