// Slide-over menu: display settings (layout, theme, units) and saved laps.
// Selecting a lap swaps the menu body for that lap's detail view.

import { useEffect, useState } from "react";
import { THEMES, useSettings, type LayoutMode } from "../lib/settings";
import { fmtDistance, toDisplay, type UnitSystem } from "../lib/units";
import { fmtDate, fmtDuration, listLaps } from "../lib/lapsApi";
import type { LapRecord } from "../types/telemetry";
import { LapDetailView } from "./LapDetail";

interface Props {
  lapId: number | null;
  lapsVersion: number; // bumped when a lap is saved, so the list refetches
  onSelectLap: (id: number | null) => void;
  onClose: () => void;
}

const LAYOUTS: { id: LayoutMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "landscape", label: "Landscape" },
  { id: "portrait", label: "Portrait" },
];

export function Menu({ lapId, lapsVersion, onSelectLap, onClose }: Props) {
  const s = useSettings();

  return (
    <div className="menu-backdrop" onClick={onClose}>
      <aside
        className="menu"
        role="dialog"
        aria-label="Menu"
        onClick={(e) => e.stopPropagation()}
      >
        {lapId !== null ? (
          <LapDetailView
            id={lapId}
            system={s.units}
            onBack={() => onSelectLap(null)}
            onDeleted={() => onSelectLap(null)}
          />
        ) : (
          <>
            <div className="menu-head">
              <h2>Menu</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close menu">
                ✕
              </button>
            </div>

            <div className="menu-body">
              <section className="menu-section">
                <h3>Layout</h3>
                <div className="segmented" role="group" aria-label="Layout">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      className={s.layout === l.id ? "active" : ""}
                      onClick={() => s.set({ layout: l.id })}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <p className="menu-note">
                  Auto follows the screen's shape (now {s.orientation}).
                </p>
              </section>

              <section className="menu-section">
                <h3>Color theme</h3>
                <div className="theme-grid">
                  {THEMES.map((th) => (
                    <button
                      key={th.id}
                      className={`theme-btn${s.theme === th.id ? " active" : ""}`}
                      onClick={() => s.set({ theme: th.id })}
                    >
                      <span
                        className="theme-swatch"
                        style={{ background: th.swatch[0], borderColor: th.swatch[1] }}
                      >
                        <span style={{ background: th.swatch[1] }} />
                      </span>
                      <span className="theme-text">
                        <span className="theme-label">{th.label}</span>
                        <span className="theme-hint">{th.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="menu-section">
                <h3>Units</h3>
                <div className="segmented" role="group" aria-label="Unit system">
                  {(["imperial", "metric"] as UnitSystem[]).map((u) => (
                    <button
                      key={u}
                      className={s.units === u ? "active" : ""}
                      onClick={() => s.set({ units: u })}
                    >
                      {u === "imperial" ? "Imperial" : "Metric"}
                    </button>
                  ))}
                </div>
              </section>

              <section className="menu-section">
                <h3>Saved laps</h3>
                <LapList version={lapsVersion} system={s.units} onSelect={onSelectLap} />
              </section>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function LapList({
  version,
  system,
  onSelect,
}: {
  version: number;
  system: UnitSystem;
  onSelect: (id: number) => void;
}) {
  const [laps, setLaps] = useState<LapRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listLaps()
      .then((l) => !cancelled && setLaps(l))
      .catch(() => !cancelled && setError("Couldn't load laps (is the backend running?)"));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (error) return <p className="menu-note">{error}</p>;
  if (laps === null) return <p className="menu-note">Loading…</p>;
  if (laps.length === 0)
    return <p className="menu-note">No laps yet. Tap “Start lap” in the top bar to record one.</p>;

  return (
    <ul className="lap-list">
      {laps.map((lap) => {
        const maxSpeed = toDisplay("speed_kmh", lap.summary?.fields.speed_kmh.max ?? null, system);
        return (
          <li key={lap.id}>
            <button className="lap-row" onClick={() => onSelect(lap.id)}>
              <span className="lap-row-main">
                <span className="lap-row-title">
                  Lap {lap.id}
                  {lap.mode === "mock" && <span className="badge warn">MOCK</span>}
                  {lap.summary?.recovered && <span className="badge muted">RECOVERED</span>}
                </span>
                <span className="lap-row-date">{fmtDate(lap.started_at)}</span>
              </span>
              <span className="lap-row-stats">
                <span>{fmtDuration(lap.duration_s === null ? null : lap.duration_s * 1000, false)}</span>
                <span>{fmtDistance(lap.summary?.distance_km ?? null, system)}</span>
                <span>
                  max {maxSpeed.value} {maxSpeed.unit}
                </span>
              </span>
              <span className="lap-row-chevron" aria-hidden>
                ›
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
