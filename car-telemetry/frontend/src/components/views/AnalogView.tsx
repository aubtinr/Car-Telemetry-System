// Analog view: a classic instrument cluster. Big speedometer and tachometer
// with tick marks, numerals, a redline band and a sweeping needle, plus four
// small dials for the secondary sensors. Needles do a full-scale sweep when the
// view opens, and a thin red needle marks the peak of the last 60 s.
//
// The Dial here is also used by the Pods view (variant "pod").

import type { ReactElement } from "react";
import { useTelemetry } from "../../transport/useTelemetry";
import { FIELD_META, toDisplay, type UnitSystem } from "../../lib/units";
import type { FieldName, FieldState, HistoryPoint } from "../../types/telemetry";
import { arcPath, polar, read } from "./read";
import { peakOf, useStartupSweep } from "./effects";
import { SevenSeg } from "./SevenSeg";

const START = 225; // bottom-left
const SWEEP = 270;
const PEAK_MS = 60_000;
const SMALL: FieldName[] = ["coolant_c", "throttle_pct", "maf_g_s", "o2_v"];

// A "nice" major tick step that gives roughly `target` divisions.
function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export type DialVariant = "big" | "small" | "pod";

export function Dial({
  field,
  state,
  system,
  history,
  variant,
  sweep,
}: {
  field: FieldName;
  state: FieldState;
  system: UnitSystem;
  history: HistoryPoint[];
  variant: DialVariant;
  sweep: number | null; // forced fraction during the startup sweep
}) {
  const r = read(field, state, system);
  const big = variant === "big";
  const pod = variant === "pod";
  const cx = 100;
  const cy = 100;
  const R = pod ? 80 : 84;
  const span = r.max - r.min;
  const step = niceStep(span, big ? 8 : pod ? 5 : 4);
  const minors = big ? 4 : pod ? 3 : 1; // minor ticks between majors
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

  const sweeping = sweep !== null;
  const needleFrac = sweeping ? sweep : r.fraction;
  const peakFrac = sweeping || r.status !== "fresh" ? null : toDisplay(field, peakOf(history, PEAK_MS), system).fraction;
  const rot = (f: number) => START + SWEEP * f - 360; // rotate from 12 o'clock
  const needleLen = R - 8;

  return (
    <div className={`dial ${variant} ${r.status}${r.inWarn ? " hot" : ""}${sweeping ? " sweeping" : ""}`}>
      <svg viewBox="0 0 200 200" role="img" aria-label={`${r.label} ${r.text} ${r.unit}`}>
        {pod && <circle className="pod-bezel" cx={cx} cy={cy} r={95} />}
        <circle className="dial-face" cx={cx} cy={cy} r={pod ? 90 : 96} />
        {warn !== undefined && (
          <path className="dial-red" d={arcPath(cx, cy, R - 3, START + SWEEP * warn, START + SWEEP)} />
        )}
        {ticks}
        <text className="dial-name" x={cx} y={big ? 66 : 70} textAnchor="middle">
          {isRpm ? "x1000 rpm" : r.label}
        </text>
        {peakFrac !== null && (
          <g className="dial-peak" style={{ transform: `rotate(${rot(peakFrac)}deg)` }}>
            <line x1={cx} y1={cy} x2={cx} y2={cy - needleLen + 4} />
          </g>
        )}
        {needleFrac !== null && (
          <g className="dial-needle" style={{ transform: `rotate(${rot(needleFrac)}deg)` }}>
            <line x1={cx} y1={cy + 12} x2={cx} y2={cy - needleLen} />
          </g>
        )}
        <circle className="dial-hub" cx={cx} cy={cy} r={big ? 7 : 6} />
        {pod ? (
          <>
            <SevenSeg
              value={r.text}
              digits={field === "o2_v" ? 3 : 4}
              className="pod-digits"
              box={{ x: 52, y: 128, width: 96, height: 32 }}
            />
            <text className="dial-unit" x={cx} y={176} textAnchor="middle">
              {r.note}
            </text>
          </>
        ) : (
          <>
            <text className="dial-value" x={cx} y={big ? 150 : 152} textAnchor="middle">
              {r.text}
            </text>
            <text className="dial-unit" x={cx} y={big ? 168 : 172} textAnchor="middle">
              {r.note}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

export function AnalogView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const sweep = useStartupSweep();
  return (
    <main className="analog">
      <div className="analog-main">
        {(["speed_kmh", "rpm"] as FieldName[]).map((f) => (
          <Dial key={f} field={f} state={t.fields[f]} system={system} history={t.history[f]} variant="big" sweep={sweep} />
        ))}
      </div>
      <div className="analog-small">
        {SMALL.map((f) => (
          <Dial key={f} field={f} state={t.fields[f]} system={system} history={t.history[f]} variant="small" sweep={sweep} />
        ))}
      </div>
    </main>
  );
}
