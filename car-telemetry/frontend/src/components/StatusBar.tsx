// Top status bar: mode, connection health, error counters, lap control, and
// the menu button. Explicit connection indicators are a hard requirement
// (handoff section 6).

import { useTelemetry } from "../transport/useTelemetry";
import type { UnitSystem } from "../lib/units";
import type { LapRecord } from "../types/telemetry";
import { LapControl } from "./LapControl";

interface Props {
  system: UnitSystem;
  onMenu: () => void;
  onLapStopped: (lap: LapRecord) => void;
}

export function StatusBar({ system, onMenu, onLapStopped }: Props) {
  const t = useTelemetry();

  const modeLabel = t.mode === "mock" ? "MOCK" : t.mode === "live" ? "LIVE" : "—";
  const modeClass = t.mode === "mock" ? "warn" : t.mode === "live" ? "ok" : "muted";

  const linkClass =
    t.link === "fresh" ? "ok" : t.link === "stale" ? "warn" : "bad";
  const wsLabel =
    t.wsStatus === "open" ? "connected" : t.wsStatus === "connecting" ? "connecting…" : "closed";

  const errs = t.errors;
  const errTotal = errs.parse + errs.oversize + errs.decode + errs.seq_gaps;

  return (
    <header className="statusbar">
      <div className="statusbar-left">
        <span className="brand">CAR TELEMETRY</span>
        <span className={`badge ${modeClass}`}>{modeLabel}</span>
        {t.isMockTransport && <span className="badge warn">UI MOCK · no backend</span>}
      </div>

      <div className="statusbar-right">
        <StatusDot
          label={`STM ${t.link}`}
          cls={linkClass}
          sub={t.lastFrameAgeMs === null ? "—" : fmtAge(t.lastFrameAgeMs)}
        />
        <StatusDot label={`WS ${wsLabel}`} cls={t.wsStatus === "open" ? "ok" : "bad"} />
        <StatusDot
          label="errors"
          cls={errTotal === 0 ? "muted" : "warn"}
          sub={`p${errs.parse} o${errs.oversize} d${errs.decode} g${errs.seq_gaps}`}
        />

        <LapControl system={system} onStopped={onLapStopped} />

        <button className="menu-btn" onClick={onMenu} aria-label="Open menu">
          ☰ Menu
        </button>
      </div>
    </header>
  );
}

function StatusDot({ label, cls, sub }: { label: string; cls: string; sub?: string }) {
  return (
    <div className="status-item">
      <span className={`dot ${cls}`} />
      <span className="status-text">
        {label}
        {sub ? <span className="status-sub"> {sub}</span> : null}
      </span>
    </div>
  );
}

function fmtAge(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
