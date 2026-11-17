// Bars view: every sensor side by side as a tall bar, like an audio
// equalizer, so the whole engine state reads in one look. A thin marker holds
// each bar's peak over the last 10 seconds; warning zones are shaded red.

import { useTelemetry } from "../../transport/useTelemetry";
import { FIELD_META, toDisplay, type UnitSystem } from "../../lib/units";
import { FIELD_NAMES } from "../../types/telemetry";
import { read } from "./read";

const PEAK_WINDOW_MS = 10_000;

export function BarsView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const now = Date.now();

  return (
    <main className="bars">
      {FIELD_NAMES.map((f) => {
        const r = read(f, t.fields[f], system);
        const recent = t.history[f].filter((p) => now - p.t <= PEAK_WINDOW_MS);
        const peakRaw = recent.length ? Math.max(...recent.map((p) => p.v)) : null;
        const peak = toDisplay(f, peakRaw, system);
        const warn = FIELD_META[f].warnFraction;

        return (
          <section key={f} className={`bar-col ${r.status}${r.inWarn ? " hot" : ""}`}>
            <div className="bar-val">{r.text}</div>
            <div className="bar-unit">{r.note}</div>
            <div className="bar-track">
              {warn !== undefined && <div className="bar-warn" style={{ height: `${(1 - warn) * 100}%` }} />}
              <div className="bar-fill" style={{ height: `${(r.fraction ?? 0) * 100}%` }} />
              {peak.fraction !== null && r.status === "fresh" && (
                <div className="bar-peak" style={{ bottom: `${peak.fraction * 100}%` }} />
              )}
            </div>
            <div className="bar-label">{r.label}</div>
            <div className="bar-peak-text">{peak.fraction !== null ? `peak ${peak.value}` : " "}</div>
          </section>
        );
      })}
    </main>
  );
}
