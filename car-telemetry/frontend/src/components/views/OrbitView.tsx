// Orbit view: concentric activity-style rings, one per sensor, closing around
// a big speed readout in the middle. A legend beside it names each ring.

import { useTelemetry } from "../../transport/useTelemetry";
import type { UnitSystem } from "../../lib/units";
import type { FieldName } from "../../types/telemetry";
import { arcPath, read } from "./read";

// Outermost first. Each ring gets its own color (see .ring-N in index.css).
const RINGS: FieldName[] = ["rpm", "throttle_pct", "coolant_c", "maf_g_s", "o2_v"];
const OUTER = 92;
const GAP = 13;

export function OrbitView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const speed = read("speed_kmh", t.fields.speed_kmh, system);
  const readings = RINGS.map((f) => read(f, t.fields[f], system));

  return (
    <main className="orbit">
      <div className="orbit-rings">
        <svg viewBox="0 0 200 200" role="img" aria-label="Sensor rings">
          {readings.map((r, i) => {
            const radius = OUTER - i * GAP;
            return (
              <g key={r.field} className={`ring ring-${i} ${r.status}${r.inWarn ? " hot" : ""}`}>
                <circle className="ring-track" cx={100} cy={100} r={radius} />
                {r.fraction !== null && r.fraction > 0.002 && (
                  <path className="ring-fill" d={arcPath(100, 100, radius, 0, 360 * r.fraction)} />
                )}
              </g>
            );
          })}
          <text className={`orbit-speed ${speed.status}`} x={100} y={108} textAnchor="middle">
            {speed.text}
          </text>
          <text className="orbit-unit" x={100} y={124} textAnchor="middle">
            {speed.note}
          </text>
        </svg>
      </div>

      <ul className="orbit-legend">
        {readings.map((r, i) => (
          <li key={r.field} className={`ring-${i} ${r.status}${r.inWarn ? " hot" : ""}`}>
            <span className="orbit-dot" />
            <span className="orbit-name">{r.label}</span>
            <span className="orbit-val">
              {r.text}
              {r.status !== "unsupported" && r.status !== "nodata" && <small> {r.unit}</small>}
            </span>
            {r.status === "stale" && <span className="orbit-note">{r.note}</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
