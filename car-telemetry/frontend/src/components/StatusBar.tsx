// Top status bar: mode, connection health, error counters, and the unit toggle.
// Explicit connection indicators are a hard requirement (handoff section 6).

import { useTelemetry } from "../transport/useTelemetry";
import type { UnitSystem } from "../lib/units";

interface Props {
  system: UnitSystem;
  onSystemChange: (s: UnitSystem) => void;
}

export function StatusBar({ system, onSystemChange }: Props) {
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

        <div className="unit-toggle" role="group" aria-label="Unit system">
          <button
            className={system === "metric" ? "active" : ""}
            onClick={() => onSystemChange("metric")}
          >
            Metric
          </button>
          <button
            className={system === "imperial" ? "active" : ""}
            onClick={() => onSystemChange("imperial")}
          >
            Imperial
          </button>
        </div>
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
