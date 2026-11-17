// Pods view: a row of aftermarket-style gauge pods, the kind mounted on an
// A-pillar or above the vents. Glowing backlit bezels, a needle sweep when the
// view opens, a red peak-hold needle, LED digits, and the bezel flashes red
// when a reading enters its warning zone. Tap a pod's label to show/hide peaks.

import { useState } from "react";
import { useTelemetry } from "../../transport/useTelemetry";
import type { UnitSystem } from "../../lib/units";
import type { FieldName } from "../../types/telemetry";
import { Dial } from "./AnalogView";
import { useStartupSweep } from "./effects";

const PODS: FieldName[] = ["rpm", "coolant_c", "throttle_pct", "maf_g_s", "o2_v", "speed_kmh"];

export function PodsView({ system }: { system: UnitSystem }) {
  const t = useTelemetry();
  const sweep = useStartupSweep(1800);
  const [peaks, setPeaks] = useState(true);

  return (
    <main className={`pods${peaks ? "" : " no-peaks"}`}>
      <div className="pods-rail">
        {PODS.map((f) => (
          <Dial
            key={f}
            field={f}
            state={t.fields[f]}
            system={system}
            history={t.history[f]}
            variant="pod"
            sweep={sweep}
          />
        ))}
      </div>
      <button className="pods-toggle" onClick={() => setPeaks((p) => !p)}>
        {peaks ? "Hide peak needles" : "Show peak needles (60 s)"}
      </button>
    </main>
  );
}
