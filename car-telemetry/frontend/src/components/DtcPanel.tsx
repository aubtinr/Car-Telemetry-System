// Trouble-code (DTC) panel. Always on screen, so "No codes" is a positive
// statement rather than an absence. Codes come from a Mode 03 check every ~5 s.

import type { DtcState } from "../types/telemetry";

const SYSTEMS: Record<string, string> = {
  P: "Powertrain",
  C: "Chassis",
  B: "Body",
  U: "Network",
};

export function DtcPanel({ dtc }: { dtc: DtcState }) {
  const hasCodes = dtc.status === "ok" && dtc.codes.length > 0;

  let statusClass: string;
  let summary: string;
  if (dtc.status === "pending") {
    statusClass = "nodata";
    summary = "Checking…";
  } else if (dtc.status === "no_response") {
    statusClass = "nodata";
    summary = "No response from ECU";
  } else if (hasCodes) {
    statusClass = "bad";
    summary = `${dtc.codes.length} code${dtc.codes.length === 1 ? "" : "s"} stored`;
  } else {
    statusClass = "ok";
    summary = "No codes";
  }

  return (
    <section className={`dtc ${statusClass}${dtc.stale ? " stale" : ""}`}>
      <div className="dtc-head">
        <div className="tile-label">Trouble codes</div>
        <div className="dtc-checked">
          {dtc.stale ? `STALE · last checked ${fmtAge(dtc.ageMs)}` : "checked every 5 s"}
        </div>
      </div>
      <div className="dtc-summary">{summary}</div>
      {hasCodes && (
        <ul className="dtc-list">
          {dtc.codes.map((code) => (
            <li key={code} className="dtc-code">
              <span className="dtc-code-id">{code}</span>
              <span className="dtc-code-sys">{SYSTEMS[code[0]] ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmtAge(ms: number | null): string {
  if (ms === null) return "never";
  return `${Math.round(ms / 1000)} s ago`;
}
