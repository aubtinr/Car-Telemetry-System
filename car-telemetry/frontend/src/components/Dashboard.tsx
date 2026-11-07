// Top-level layout: status bar, two large gauges (Speed + RPM), four tiles,
// trouble codes, and the 60 s trend, arranged for landscape (two columns) or
// portrait (one column). Also owns the menu and the "lap saved" notice.

import { useEffect, useState } from "react";
import { useTelemetry } from "../transport/useTelemetry";
import { useSettings } from "../lib/settings";
import { StatusBar } from "./StatusBar";
import { Gauge } from "./Gauge";
import { MetricTile } from "./MetricTile";
import { TrendChart } from "./TrendChart";
import { DtcPanel } from "./DtcPanel";
import { Menu } from "./Menu";
import { fieldLabel, fmtDistance } from "../lib/units";
import { fmtDuration } from "../lib/lapsApi";
import type { FieldName, LapRecord } from "../types/telemetry";

const TILE_FIELDS: FieldName[] = ["coolant_c", "throttle_pct", "maf_g_s", "o2_v"];
const SAVED_NOTICE_MS = 10_000;

export function Dashboard() {
  const t = useTelemetry();
  const { units: system, orientation } = useSettings();
  const [trendField, setTrendField] = useState<FieldName>("speed_kmh");
  const [menu, setMenu] = useState<{ open: boolean; lapId: number | null }>({
    open: false,
    lapId: null,
  });
  const [savedLap, setSavedLap] = useState<LapRecord | null>(null);
  const [lapsVersion, setLapsVersion] = useState(0);

  useEffect(() => {
    if (!savedLap) return;
    const id = window.setTimeout(() => setSavedLap(null), SAVED_NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [savedLap]);

  const disconnected = t.link === "disconnected";
  const codes = t.dtc.status === "ok" ? t.dtc.codes : [];

  return (
    <div className="app">
      <StatusBar
        system={system}
        onMenu={() => setMenu({ open: true, lapId: null })}
        onLapStopped={(lap) => {
          setSavedLap(lap);
          setLapsVersion((v) => v + 1);
        }}
      />

      {disconnected && (
        <div className="banner">
          No live vehicle data — {t.wsStatus !== "open" ? "backend/WebSocket unreachable" : "STM link down"}.
          Readings below are not current.
        </div>
      )}

      {codes.length > 0 && (
        <div className="banner warn">
          Check engine — {codes.length} trouble code{codes.length === 1 ? "" : "s"}:{" "}
          {codes.join(", ")}
        </div>
      )}

      {savedLap && (
        <div className="banner ok">
          <span>
            Lap {savedLap.id} saved ·{" "}
            {fmtDuration(savedLap.duration_s === null ? null : savedLap.duration_s * 1000)} ·{" "}
            {fmtDistance(savedLap.summary?.distance_km ?? null, system)}
          </span>
          <button
            className="banner-btn"
            onClick={() => {
              setMenu({ open: true, lapId: savedLap.id });
              setSavedLap(null);
            }}
          >
            View
          </button>
        </div>
      )}

      <main className={`dash ${orientation}`}>
        <div className="dash-primary">
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
        </div>

        <div className="dash-secondary">
          <DtcPanel dtc={t.dtc} />
          <TrendChart field={trendField} system={system} onFieldChange={setTrendField} />
        </div>
      </main>

      {menu.open && (
        <Menu
          lapId={menu.lapId}
          lapsVersion={lapsVersion}
          onSelectLap={(id) => setMenu({ open: true, lapId: id })}
          onClose={() => setMenu({ open: false, lapId: null })}
        />
      )}
    </div>
  );
}
