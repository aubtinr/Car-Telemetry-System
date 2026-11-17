// LCD view: an 80s/90s digital dash. Everything sits behind one glass panel
// with faint unlit segments showing through: a staircase bar tach that climbs
// to the redline, big seven-segment speed, block-bar gauges with C/H-style end
// marks, and a trip readout that runs while a lap is recording.

import { useTelemetry } from "../../transport/useTelemetry";
import { FIELD_META, type UnitSystem } from "../../lib/units";
import type { FieldName } from "../../types/telemetry";
import { read } from "./read";
import { SevenSeg } from "./SevenSeg";

const TACH_BARS = 32;
const REDLINE = FIELD_META.rpm.warnFraction ?? 0.85;
const BLOCKS = 14;

const GAUGES: { field: FieldName; lo: string; hi: string }[] = [
  { field: "coolant_c", lo: "C", hi: "H" },
  { field: "throttle_pct", lo: "0", hi: "100" },
  { field: "maf_g_s", lo: "0", hi: "60" },
  { field: "o2_v", lo: "L", hi: "R" }, // lean / rich
];

export function LcdView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const rpm = read("rpm", t.fields.rpm, system);
  const speed = read("speed_kmh", t.fields.speed_kmh, system);
  const lit = Math.round((rpm.fraction ?? 0) * TACH_BARS);
  const tripKm = t.lap.active ? t.lap.distanceKm : null;
  const trip = tripKm === null ? "—" : (system === "imperial" ? tripKm * 0.621371 : tripKm).toFixed(1);

  return (
    <main className="lcd">
      <div className={`lcd-glass${rpm.inWarn ? " shift" : ""}`}>
        <section className="lcd-tach" aria-label={`RPM ${rpm.text}`}>
          <div className="lcd-bars">
            {Array.from({ length: TACH_BARS }, (_, i) => {
              const f = i / TACH_BARS;
              const height = 12 + 88 * (i / (TACH_BARS - 1)) ** 1.25;
              return (
                <span
                  key={i}
                  className={`lcd-bar${i < lit ? " on" : ""}${f >= REDLINE ? " red" : ""}`}
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
          <div className="lcd-scale">
            {Array.from({ length: 8 }, (_, k) => (
              <span key={k} className={k / 7 >= REDLINE ? "red" : ""}>
                {k}
              </span>
            ))}
          </div>
          <div className="lcd-cap">
            RPM x1000
            <span className={`lcd-rpm ${rpm.status}`}>
              <SevenSeg value={rpm.text} digits={4} />
            </span>
          </div>
        </section>

        <section className={`lcd-speed ${speed.status}`}>
          <SevenSeg value={speed.text} digits={3} className="lcd-speed-digits" label={`Speed ${speed.text}`} />
          <div className="lcd-speed-unit">{speed.note.toUpperCase()}</div>
        </section>

        <section className="lcd-gauges">
          {GAUGES.map(({ field, lo, hi }) => {
            const r = read(field, t.fields[field], system);
            const on = Math.round((r.fraction ?? 0) * BLOCKS);
            const warn = FIELD_META[field].warnFraction;
            return (
              <div key={field} className={`lcd-gauge ${r.status}${r.inWarn ? " hot" : ""}`}>
                <div className="lcd-gauge-head">
                  <span>{r.label}</span>
                  <SevenSeg value={r.text} digits={3} className="lcd-gauge-digits" />
                </div>
                <div className="lcd-blocks">
                  <span className="lcd-end">{lo}</span>
                  {Array.from({ length: BLOCKS }, (_, i) => (
                    <span
                      key={i}
                      className={`lcd-block${i < on ? " on" : ""}${warn !== undefined && i / BLOCKS >= warn ? " red" : ""}`}
                    />
                  ))}
                  <span className="lcd-end">{hi}</span>
                </div>
              </div>
            );
          })}
        </section>

        <section className="lcd-foot">
          <div className={`lcd-trip${t.lap.active ? " on" : ""}`}>
            <span>TRIP</span>
            <SevenSeg value={trip} digits={4} className="lcd-trip-digits" />
            <span>{system === "imperial" ? "MI" : "KM"}</span>
          </div>
          <div className={`lcd-tell${t.dtc.codes.length ? " on" : ""}`}>CHECK ENGINE</div>
          <div className={`lcd-tell${t.link !== "fresh" ? " on" : ""}`}>NO SIGNAL</div>
          <div className={`lcd-tell${rpm.inWarn ? " on" : ""}`}>SHIFT</div>
        </section>
      </div>
    </main>
  );
}
