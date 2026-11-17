// HUD view: as little as possible, readable at a glance. One huge speed
// number, a thin RPM line, and warnings only when something needs attention.
// "Mirror" flips it top-to-bottom so it reads correctly as a reflection when
// the screen lies flat under the windshield, like a head-up display.

import { useTelemetry } from "../../transport/useTelemetry";
import { useSettings } from "../../lib/settings";
import { FIELD_META, type UnitSystem } from "../../lib/units";
import { read } from "./read";

export function HudView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const { hudMirror, set } = useSettings();
  const speed = read("speed_kmh", t.fields.speed_kmh, system);
  const rpm = read("rpm", t.fields.rpm, system);
  const coolant = read("coolant_c", t.fields.coolant_c, system);
  const redline = FIELD_META.rpm.warnFraction ?? 1;

  const alerts: string[] = [];
  if (coolant.inWarn) alerts.push(`HOT ${coolant.text}${coolant.unit}`);
  if (t.dtc.codes.length) alerts.push(`CHECK ENGINE · ${t.dtc.codes.length}`);
  if (t.link !== "fresh") alerts.push("NO LIVE DATA");

  return (
    <main className="hud-wrap">
      <div className={`hud${hudMirror ? " mirrored" : ""}${rpm.inWarn ? " shift" : ""}`}>
        <div className={`hud-speed ${speed.status}`}>{speed.text}</div>
        <div className="hud-unit">{speed.note}</div>
        <div className="hud-rpm" aria-label={`RPM ${rpm.text}`}>
          <div className="hud-rpm-fill" style={{ width: `${(rpm.fraction ?? 0) * 100}%` }} />
          <div className="hud-rpm-red" style={{ left: `${redline * 100}%` }} />
        </div>
        <div className="hud-rpm-text">{rpm.text} rpm</div>
        <div className="hud-alerts">
          {alerts.map((a) => (
            <span key={a} className="hud-alert">
              {a}
            </span>
          ))}
        </div>
      </div>
      <button className="hud-mirror-btn" onClick={() => set({ hudMirror: !hudMirror })}>
        {hudMirror ? "Unmirror" : "Mirror for windshield"}
      </button>
    </main>
  );
}
