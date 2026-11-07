// One saved lap: summary metrics, trouble codes seen, and a chart of any
// metric across the whole lap. Delete asks for confirmation inline.

import { useEffect, useState } from "react";
import { FIELD_NAMES, type FieldName, type LapDetail } from "../types/telemetry";
import { FIELD_META, fieldLabel, fmtDistance, toDisplay, type UnitSystem } from "../lib/units";
import { deleteLap, fmtDate, fmtDuration, getLap } from "../lib/lapsApi";

interface Props {
  id: number;
  system: UnitSystem;
  onBack: () => void;
  onDeleted: () => void;
}

export function LapDetailView({ id, system, onBack, onDeleted }: Props) {
  const [lap, setLap] = useState<LapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<FieldName>("speed_kmh");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLap(id)
      .then((l) => !cancelled && setLap(l))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "couldn't load lap"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const remove = async () => {
    try {
      await deleteLap(id);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't delete lap");
      setConfirming(false);
    }
  };

  const summary = lap?.summary;

  return (
    <>
      <div className="menu-head">
        <button className="icon-btn back" onClick={onBack}>
          ‹ Laps
        </button>
        <h2>Lap {id}</h2>
        {confirming ? (
          <div className="confirm">
            <button className="danger-btn" onClick={remove}>
              Delete
            </button>
            <button className="icon-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="icon-btn" onClick={() => setConfirming(true)} disabled={!lap}>
            Delete
          </button>
        )}
      </div>

      <div className="menu-body">
        {error && <p className="menu-note">{error}</p>}
        {!lap && !error && <p className="menu-note">Loading…</p>}

        {lap && (
          <>
            <p className="menu-note">
              {fmtDate(lap.started_at)} · {lap.sample_count.toLocaleString()} samples
              {lap.mode === "mock" && " · MOCK data"}
              {summary?.recovered && " · recovered after the backend stopped unexpectedly"}
            </p>

            <div className="lap-headline">
              <Stat
                label="Duration"
                value={fmtDuration(lap.duration_s === null ? null : lap.duration_s * 1000)}
              />
              <Stat label="Distance" value={fmtDistance(summary?.distance_km ?? null, system)} />
              <Stat label="Max speed" value={fmtField("speed_kmh", summary?.fields.speed_kmh.max, system)} />
              <Stat label="Max RPM" value={fmtField("rpm", summary?.fields.rpm.max, system)} />
            </div>

            <section className="menu-section">
              <h3>Metrics</h3>
              <div className="table-wrap">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Min</th>
                      <th>Avg</th>
                      <th>Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FIELD_NAMES.map((f) => {
                      const st = summary?.fields[f];
                      return (
                        <tr key={f}>
                          <th>{fieldLabel(f)}</th>
                          <td>{fmtField(f, st?.min, system)}</td>
                          <td>{fmtField(f, st?.avg, system)}</td>
                          <td>{fmtField(f, st?.max, system)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="menu-section">
              <h3>Trouble codes during lap</h3>
              {summary && summary.codes.length > 0 ? (
                <ul className="dtc-list">
                  {summary.codes.map((c) => (
                    <li key={c} className="dtc-code">
                      <span className="dtc-code-id">{c}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="menu-note">None</p>
              )}
            </section>

            <section className="menu-section">
              <h3>Over the lap</h3>
              <LapChart lap={lap} field={field} system={system} />
              <div className="trend-picker" role="group" aria-label="Lap chart metric">
                {FIELD_NAMES.map((f) => (
                  <button
                    key={f}
                    className={f === field ? "active" : ""}
                    onClick={() => setField(f)}
                  >
                    {fieldLabel(f)}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lap-stat">
      <span className="tile-label">{label}</span>
      <span className="lap-stat-value">{value}</span>
    </div>
  );
}

function fmtField(field: FieldName, v: number | null | undefined, system: UnitSystem): string {
  const d = toDisplay(field, v ?? null, system);
  return d.display === null ? "—" : `${d.value} ${d.unit}`;
}

const W = 1000;
const H = 220;
const PAD_L = 48;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 24;

function LapChart({ lap, field, system }: { lap: LapDetail; field: FieldName; system: UnitSystem }) {
  const meta = FIELD_META[field];
  const imperial = system === "imperial";
  const yMin = imperial ? meta.imperialMin : meta.metricMin;
  const yMax = imperial ? meta.imperialMax : meta.metricMax;
  const conv = imperial ? meta.toImperial : (v: number) => v;

  const ts = lap.samples.t_ms;
  const vs = lap.samples[field];
  const tEnd = Math.max(1, ts.length ? ts[ts.length - 1] : 1);

  const x = (t: number) => PAD_L + (t / tEnd) * (W - PAD_L - PAD_R);
  const y = (v: number) =>
    PAD_T + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);

  // Break the line where the PID didn't answer, rather than drawing through gaps.
  let d = "";
  let pen = false;
  for (let i = 0; i < ts.length; i++) {
    const v = vs[i];
    if (v === null || v === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"} ${x(ts[i]).toFixed(1)} ${y(conv(v)).toFixed(1)} `;
    pen = true;
  }

  const gridVals = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {gridVals.map((gv) => (
        <g key={gv}>
          <line className="trend-grid" x1={PAD_L} x2={W - PAD_R} y1={y(gv)} y2={y(gv)} />
          <text className="trend-ylabel" x={PAD_L - 6} y={y(gv) + 4} textAnchor="end">
            {gv.toLocaleString(undefined, { maximumFractionDigits: meta.decimals })}
          </text>
        </g>
      ))}
      <text className="trend-ylabel" x={PAD_L} y={H - 6}>
        0:00
      </text>
      <text className="trend-ylabel" x={W - PAD_R} y={H - 6} textAnchor="end">
        {fmtDuration(tEnd, false)}
      </text>
      {d && <path className="trend-line" d={d} />}
    </svg>
  );
}
