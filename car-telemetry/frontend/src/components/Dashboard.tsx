// Top-level layout: status bar, two large gauges (Speed + RPM), four tiles,
// and the 60 s trend. Holds the two bits of view state: unit system + trend metric.

import { useState } from "react";
import { useTelemetry } from "../transport/useTelemetry";
import { StatusBar } from "./StatusBar";
import { Gauge } from "./Gauge";
import { MetricTile } from "./MetricTile";
import { TrendChart } from "./TrendChart";
import { fieldLabel, type UnitSystem } from "../lib/units";
import type { FieldName } from "../types/telemetry";

const TILE_FIELDS: FieldName[] = ["coolant_c", "throttle_pct", "maf_g_s", "o2_v"];

export function Dashboard() {
  const t = useTelemetry();
  const [system, setSystem] = useState<UnitSystem>("imperial");
  const [trendField, setTrendField] = useState<FieldName>("speed_kmh");

  const disconnected = t.link === "disconnected";

  return (
    <div className="app">
      <StatusBar system={system} onSystemChange={setSystem} />

      {disconnected && (
        <div className="banner">
          No live vehicle data — {t.wsStatus !== "open" ? "backend/WebSocket unreachable" : "STM link down"}.
          Readings below are not current.
        </div>
      )}

      <main className="dash">
        <section className="gauges">
          <div className="gauge-cell">
            <div className="gauge-title">{fieldLabel("speed_kmh")}</div>
            <Gauge field="speed_kmh" state={t.fields.speed_kmh} system={system} />
          </div>
          <div className="gauge-cell">
            <div className="gauge-title">{fieldLabel("rpm")}</div>
            <Gauge field="rpm" state={t.fields.rpm} system={system} />
          </div>
        </section>

        <section className="tiles">
          {TILE_FIELDS.map((f) => (
            <MetricTile key={f} field={f} state={t.fields[f]} system={system} />
          ))}
        </section>

        <TrendChart field={trendField} system={system} onFieldChange={setTrendField} />
      </main>
    </div>
  );
}
