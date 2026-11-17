// Analog view: a classic instrument cluster. Big speedometer and tachometer
// with tick marks, numerals, a redline band and a sweeping needle, plus four
// small dials for the secondary sensors.

import type { ReactElement } from "react";
import { useTelemetry } from "../../transport/useTelemetry";
import { FIELD_META, type UnitSystem } from "../../lib/units";
import type { FieldName, FieldState } from "../../types/telemetry";
import { arcPath, polar, read } from "./read";

const START = 225; // bottom-left
const SWEEP = 270;
const SMALL: FieldName[] = ["coolant_c", "throttle_pct", "maf_g_s", "o2_v"];

// A "nice" major tick step that gives roughly `target` divisions.
function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function Dial({
  field,
  state,
  system,
  big,
}: {
  field: FieldName;
  state: FieldState;
  system: UnitSystem;
  big?: boolean;
}) {
  const r = read(field, state, system);
  const cx = 100;
  const cy = 100;
  const R = 84;
  const span = r.max - r.min;
  const step = niceStep(span, big ? 8 : 4);
  const minors = big ? 4 : 1; // minor ticks between majors
  const isRpm = field === "rpm";
  const warn = FIELD_META[field].warnFraction;

  const ticks: ReactElement[] = [];
  const minorStep = step / (minors + 1);
  for (let i = 0; r.min + i * minorStep <= r.max + 1e-9; i++) {
    const frac = (i * minorStep) / span;
    const major = i % (minors + 1) === 0;
    const a = START + SWEEP * frac;
    const p0 = polar(cx, cy, R, a);
    const p1 = polar(cx, cy, R - (major ? 12 : 6), a);
    const hot = warn !== undefined && frac >= warn;
    ticks.push(
      <line
        key={`t${i}`}
        className={`dial-tick${major ? " major" : ""}${hot ? " hot" : ""}`}
        x1={p0.x}
        y1={p0.y}
        x2={p1.x}
        y2={p1.y}
      />,
    );
    if (major) {
      const v = r.min + frac * span;
      const lp = polar(cx, cy, R - (big ? 26 : 24), a);
      const label = isRpm ? String(Math.round(v / 1000)) : String(+v.toFixed(2));
      ticks.push(
        <text key={`l${i}`} className={`dial-num${hot ? " hot" : ""}`} x={lp.x} y={lp.y + 4} textAnchor="middle">
          {label}
        </text>,
      );
    }
  }

  const angle = START + SWEEP * (r.fraction ?? 0) - 360; // rotate from 12 o'clock
  const needleLen = R - 8;

  return (
    <div className={`dial ${big ? "big" : "small"} ${r.status}`}>
      <svg viewBox="0 0 200 200" role="img" aria-label={`${r.label} ${r.text} ${r.unit}`}>
        <circle className="dial-face" cx={cx} cy={cy} r={96} />
        {warn !== undefined && (
          <path className="dial-red" d={arcPath(cx, cy, R - 3, START + SWEEP * warn, START + SWEEP)} />
        )}
        {ticks}
        <text className="dial-name" x={cx} y={big ? 66 : 70} textAnchor="middle">
          {isRpm ? "x1000 rpm" : r.label}
        </text>
        {r.fraction !== null && (
          <g className="dial-needle" style={{ transform: `rotate(${angle}deg)` }}>
            <line x1={cx} y1={cy + 12} x2={cx} y2={cy - needleLen} />
          </g>
        )}
        <circle className="dial-hub" cx={cx} cy={cy} r={big ? 7 : 6} />
        <text className="dial-value" x={cx} y={big ? 150 : 152} textAnchor="middle">
          {r.text}
        </text>
        <text className="dial-unit" x={cx} y={big ? 168 : 172} textAnchor="middle">
          {r.note}
        </text>
      </svg>
    </div>
  );
}

export function AnalogView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  return (
    <main className="analog">
      <div className="analog-main">
        <Dial field="speed_kmh" state={t.fields.speed_kmh} system={system} big />
        <Dial field="rpm" state={t.fields.rpm} system={system} big />
      </div>
      <div className="analog-small">
        {SMALL.map((f) => (
          <Dial key={f} field={f} state={t.fields[f]} system={system} />
        ))}
      </div>
    </main>
  );
}
