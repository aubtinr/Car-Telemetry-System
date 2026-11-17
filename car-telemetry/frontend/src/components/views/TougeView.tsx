// Touge view: a late-night mountain-pass look. A wide neon tach sweeps across
// the top in segments that grow taller toward the redline, a synthwave sun sits
// behind it, and a perspective road grid scrolls underneath at a pace that
// follows the car's real speed. Readouts use seven-segment digits and carry
// Japanese labels alongside the English ones.

import { useEffect, useRef } from "react";
import { useTelemetry } from "../../transport/useTelemetry";
import { FIELD_META, type UnitSystem } from "../../lib/units";
import type { FieldName } from "../../types/telemetry";
import { polar, read } from "./read";
import { SevenSeg } from "./SevenSeg";

const SEGMENTS = 44;
const A0 = -64; // degrees from 12 o'clock
const A1 = 64;
const CX = 200;
const CY = 262;
const R_IN = 168;
const REDLINE = FIELD_META.rpm.warnFraction ?? 0.85;
const GRID_PX = 64; // must match background-size in .touge-grid

const BOXES: { field: FieldName; jp: string; digits: number }[] = [
  { field: "coolant_c", jp: "水温", digits: 3 },
  { field: "throttle_pct", jp: "開度", digits: 3 },
  { field: "maf_g_s", jp: "吸気", digits: 3 },
  { field: "o2_v", jp: "酸素", digits: 3 },
];

function segPoints(i: number) {
  const step = (A1 - A0) / SEGMENTS;
  const a0 = A0 + i * step + step * 0.12;
  const a1 = A0 + (i + 1) * step - step * 0.12;
  const rOut = R_IN + 16 + 26 * (i / (SEGMENTS - 1)) ** 1.6; // taller toward redline
  return [polar(CX, CY, R_IN, a0), polar(CX, CY, rOut, a0), polar(CX, CY, rOut, a1), polar(CX, CY, R_IN, a1)]
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
}
const SEG_POINTS = Array.from({ length: SEGMENTS }, (_, i) => segPoints(i));

function zone(f: number) {
  if (f >= REDLINE) return "z-red";
  if (f >= REDLINE - 0.15) return "z-hi";
  if (f >= 0.4) return "z-mid";
  return "z-lo";
}

export function TougeView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const rpm = read("rpm", t.fields.rpm, system);
  const speed = read("speed_kmh", t.fields.speed_kmh, system);
  const lit = Math.round((rpm.fraction ?? 0) * SEGMENTS);

  // Road grid: scroll with requestAnimationFrame so speed changes stay smooth.
  const gridRef = useRef<HTMLDivElement>(null);
  const kmhRef = useRef(0);
  kmhRef.current = speed.status === "fresh" ? (t.fields.speed_kmh.value ?? 0) : 0;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let offset = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      offset = (offset + kmhRef.current * 2.4 * dt) % GRID_PX;
      if (gridRef.current) gridRef.current.style.backgroundPosition = `0 ${offset.toFixed(1)}px`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const labels = Array.from({ length: 8 }, (_, k) => {
    const a = A0 + (A1 - A0) * (k / 7);
    const p = polar(CX, CY, R_IN + 54, a);
    return (
      <text key={k} x={p.x} y={p.y} textAnchor="middle" className={`touge-num${k / 7 >= REDLINE ? " red" : ""}`}>
        {k}
      </text>
    );
  });

  return (
    <main className={`touge${rpm.inWarn ? " shift" : ""}`}>
      <div className="touge-sky" aria-hidden>
        <div className="touge-sun" />
        <div className="touge-ridge" />
      </div>
      <div className="touge-grid" ref={gridRef} aria-hidden />

      <section className="touge-tach">
        <svg viewBox="-24 24 448 176" role="img" aria-label={`RPM ${rpm.text}`}>
          {SEG_POINTS.map((pts, i) => (
            <polygon key={i} points={pts} className={`tseg ${zone(i / SEGMENTS)}${i < lit ? " on" : ""}`} />
          ))}
          {labels}
          <text x={CX} y={128} textAnchor="middle" className="touge-tach-cap">
            回転 · x1000 RPM
          </text>
        </svg>
        <div className="touge-shift">シフト SHIFT</div>
      </section>

      <section className={`touge-speed ${speed.status}`}>
        <SevenSeg value={speed.text} digits={3} className="touge-speed-digits" label={`Speed ${speed.text}`} />
        <div className="touge-speed-cap">
          <span className="jp">速度</span> {speed.note}
        </div>
        <div className={`touge-rpm-digits ${rpm.status}`}>
          <SevenSeg value={rpm.text} digits={4} label={`RPM ${rpm.text}`} />
          <span>rpm</span>
        </div>
      </section>

      <section className="touge-boxes">
        {BOXES.map(({ field, jp, digits }) => {
          const r = read(field, t.fields[field], system);
          return (
            <div key={field} className={`touge-box ${r.status}${r.inWarn ? " hot" : ""}`}>
              <div className="touge-box-head">
                <span className="jp">{jp}</span>
                <span className="en">{r.label}</span>
              </div>
              <SevenSeg value={r.text} digits={digits} className="touge-box-digits" label={`${r.label} ${r.text}`} />
              <div className="touge-box-unit">{r.note}</div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
