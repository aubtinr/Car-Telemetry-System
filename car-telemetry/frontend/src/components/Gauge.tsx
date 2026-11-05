// Reusable SVG arc gauge. No chart library — just geometry — so it stays light
// and crisp on the touchscreen. Used large for Speed and RPM.

import type { FieldName, FieldState } from "../types/telemetry";
import { toDisplay, warnFraction, type UnitSystem } from "../lib/units";

const START = 225; // degrees, bottom-left (0 = top, increasing clockwise)
const SWEEP = 270; // leaves a gap at the bottom

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = (a1 - a0) % 360 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

interface Props {
  field: FieldName;
  state: FieldState;
  system: UnitSystem;
}

export function Gauge({ field, state, system }: Props) {
  const d = toDisplay(field, state.value, system);
  const unsupported = state.supported === false;
  const noData = !unsupported && state.value === null;
  const stale = state.stale && !unsupported && !noData;

  const frac = unsupported || noData ? null : d.fraction;
  const warn = warnFraction(field);

  const cx = 100;
  const cy = 100;
  const r = 78;

  const track = arcPath(cx, cy, r, START, START + SWEEP);
  const valueArc = frac !== null ? arcPath(cx, cy, r, START, START + SWEEP * frac) : null;
  const warnArc =
    warn !== undefined ? arcPath(cx, cy, r, START + SWEEP * warn, START + SWEEP) : null;

  const statusClass = unsupported
    ? "unsupported"
    : noData
      ? "nodata"
      : stale
        ? "stale"
        : "fresh";

  const subtitle = unsupported
    ? "unsupported"
    : noData
      ? "no data"
      : stale
        ? `stale · ${fmtAge(state.ageMs)}`
        : d.unit;

  return (
    <div className={`gauge ${statusClass}`}>
      <svg viewBox="0 0 200 200" role="img" aria-label={`${field} gauge`}>
        <path className="gauge-track" d={track} />
        {warnArc && <path className="gauge-warn" d={warnArc} />}
        {valueArc && <path className="gauge-value" d={valueArc} />}
        <text className="gauge-number" x="100" y="104" textAnchor="middle">
          {unsupported ? "N/A" : d.value}
        </text>
        <text className="gauge-unit" x="100" y="130" textAnchor="middle">
          {subtitle}
        </text>
      </svg>
    </div>
  );
}

function fmtAge(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
