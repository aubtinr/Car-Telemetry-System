// Race view, modeled on motorsport digital dashes: a progressive shift-light
// bar across the top (green → amber → red, flashing at the shift point), a huge
// digital speed, RPM as a segmented bar graph, and compact data boxes.

import { useTelemetry } from "../../transport/useTelemetry";
import { FIELD_META, type UnitSystem } from "../../lib/units";
import { fmtDuration } from "../../lib/lapsApi";
import { fmtDistance } from "../../lib/units";
import type { FieldName } from "../../types/telemetry";
import { read } from "./read";

const LEDS = 15;
const SHIFT_START_RPM = 3500; // first light comes on here
const SHIFT_RPM = FIELD_META.rpm.metricMax * (FIELD_META.rpm.warnFraction ?? 0.85); // all lit, flashing
const RPM_SEGMENTS = 28;
const BOX_FIELDS: FieldName[] = ["coolant_c", "throttle_pct", "maf_g_s", "o2_v"];

export function RaceView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const rpm = read("rpm", t.fields.rpm, system);
  const speed = read("speed_kmh", t.fields.speed_kmh, system);

  const rpmVal = rpm.status === "fresh" ? (t.fields.rpm.value ?? 0) : 0;
  const lit = Math.max(
    0,
    Math.min(LEDS, Math.ceil(((rpmVal - SHIFT_START_RPM) / (SHIFT_RPM - SHIFT_START_RPM)) * LEDS)),
  );
  const shiftNow = rpmVal >= SHIFT_RPM;
  const rpmSegs = Math.round((rpm.fraction ?? 0) * RPM_SEGMENTS);
  const redSeg = Math.floor((FIELD_META.rpm.warnFraction ?? 1) * RPM_SEGMENTS);

  return (
    <main className="race">
      <div className={`shift-bar${shiftNow ? " shift-now" : ""}`} aria-label="Shift lights">
        {Array.from({ length: LEDS }, (_, i) => {
          const zone = i < LEDS * 0.4 ? "g" : i < LEDS * 0.75 ? "a" : "r";
          return <span key={i} className={`led ${zone}${i < lit ? " on" : ""}`} />;
        })}
      </div>

      <div className="race-grid">
        <section className={`race-rpm ${rpm.status}`}>
          <div className="race-label">RPM</div>
          <div className={`race-rpm-num${rpm.inWarn ? " hot" : ""}`}>{rpm.text}</div>
          <div className="rpm-segs">
            {Array.from({ length: RPM_SEGMENTS }, (_, i) => (
              <span key={i} className={`seg${i < rpmSegs ? " on" : ""}${i >= redSeg ? " red" : ""}`} />
            ))}
          </div>
          <div className="race-note">{rpm.status === "fresh" ? `redline ${SHIFT_RPM.toLocaleString()}` : rpm.note}</div>
        </section>

        <section className={`race-speed ${speed.status}`}>
          <div className="race-speed-num">{speed.text}</div>
          <div className="race-speed-unit">{speed.note}</div>
        </section>

        <section className="race-boxes">
          {BOX_FIELDS.map((f) => {
            const r = read(f, t.fields[f], system);
            return (
              <div key={f} className={`race-box ${r.status}${r.inWarn ? " hot" : ""}`}>
                <span className="race-box-label">{r.label}</span>
                <span className="race-box-val">
                  {r.text}
                  {r.status !== "unsupported" && r.status !== "nodata" && <small> {r.unit}</small>}
                </span>
              </div>
            );
          })}
        </section>
      </div>

      <div className="race-foot">
        <div className={`race-lap${t.lap.active ? " on" : ""}`}>
          <span className="race-label">LAP</span>
          <span className="race-lap-time">{t.lap.active ? fmtDuration(t.lap.elapsedMs) : "--:--.-"}</span>
          <span className="race-lap-dist">{t.lap.active ? fmtDistance(t.lap.distanceKm, system) : "not recording"}</span>
        </div>
        <div className={`race-cel${t.dtc.codes.length ? " on" : ""}`}>
          {t.dtc.codes.length
            ? `CEL · ${t.dtc.codes.length}`
            : t.dtc.status === "ok"
              ? "NO CODES"
              : "CODES —"}
        </div>
      </div>
    </main>
  );
}
