// Shared 60-second trend line beneath the gauges. One selectable metric.
// Plain SVG, bounded history — no fabricated points, gaps stay gaps.

import { FIELD_NAMES, type FieldName } from "../types/telemetry";
import { FIELD_META, fieldLabel, type UnitSystem } from "../lib/units";
import { useTelemetry } from "../transport/useTelemetry";

const WINDOW_MS = 60_000;
const W = 1000; // viewBox units
const H = 220;
const PAD_L = 48;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 22;

interface Props {
  field: FieldName;
  system: UnitSystem;
  onFieldChange: (f: FieldName) => void;
}

export function TrendChart({ field, system, onFieldChange }: Props) {
  const t = useTelemetry();
  const meta = FIELD_META[field];
  const imperial = system === "imperial";
  const unit = imperial ? meta.imperialUnit : meta.metricUnit;
  const yMin = imperial ? meta.imperialMin : meta.metricMin;
  const yMax = imperial ? meta.imperialMax : meta.metricMax;
  const conv = imperial ? meta.toImperial : (v: number) => v;

  const now = Date.now();
  const pts = t.history[field]
    .filter((p) => p.t >= now - WINDOW_MS)
    .map((p) => ({ t: p.t, v: conv(p.v) }));

  const x = (tms: number) => PAD_L + ((tms - (now - WINDOW_MS)) / WINDOW_MS) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);

  const line = pts.length
    ? pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(clamp(p.v, yMin, yMax)).toFixed(1)}`).join(" ")
    : "";

  const gridVals = [yMin, (yMin + yMax) / 2, yMax];
  const current = pts.length ? pts[pts.length - 1].v : null;

  return (
    <section className="trend">
      <div className="trend-head">
        <div className="trend-title">
          {fieldLabel(field)} <span className="trend-unit">· last 60 s ({unit})</span>
        </div>
        <div className="trend-current">
          {current === null
            ? "—"
            : current.toLocaleString(undefined, {
                minimumFractionDigits: meta.decimals,
                maximumFractionDigits: meta.decimals,
              })}
          {current !== null && <span className="trend-current-unit"> {unit}</span>}
        </div>
      </div>

      <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {gridVals.map((gv) => (
          <g key={gv}>
            <line className="trend-grid" x1={PAD_L} x2={W - PAD_R} y1={y(gv)} y2={y(gv)} />
            <text className="trend-ylabel" x={PAD_L - 6} y={y(gv) + 4} textAnchor="end">
              {gv.toLocaleString(undefined, { maximumFractionDigits: meta.decimals })}
            </text>
          </g>
        ))}
        {line && <path className="trend-line" d={line} />}
      </svg>

      <div className="trend-picker" role="group" aria-label="Trend metric">
        {FIELD_NAMES.map((f) => (
          <button
            key={f}
            className={f === field ? "active" : ""}
            onClick={() => onFieldChange(f)}
          >
            {fieldLabel(f)}
          </button>
        ))}
      </div>
    </section>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
