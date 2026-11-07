// Client-side mock transport: generates envelopes in the browser, no backend.
// Enabled with ?mock=1 in the URL. The handoff asks for a mock provider that
// uses the exact same envelope/field names and never silently replaces live data,
// so this is clearly flagged as a mock transport in the UI.
//
// (The backend also has a mock mode, which is the fuller test because it exercises
// the decoder and framing. This one exists so the UI alone runs with zero setup.)

import type { Envelope, FieldName } from "../types/telemetry";

const FIELDS: FieldName[] = [
  "rpm",
  "speed_kmh",
  "coolant_c",
  "maf_g_s",
  "throttle_pct",
  "o2_v",
];

export function startClientMock(onEnvelope: (env: Envelope) => void): () => void {
  const t0 = performance.now();
  let seq = 0;

  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    const speed = clamp(55 + 45 * (0.5 + 0.5 * Math.sin(t / 18)) + rand(-2, 2), 0, 160);
    const rpm = clamp(900 + speed * 34 + 400 * Math.sin(t / 5) + rand(-80, 80), 700, 6500);
    const coolant = Math.min(95, 35 + t * 1.2) + rand(-0.5, 0.5);
    const throttle = clamp(18 + 22 * Math.sin(t / 4) + rand(-3, 3), 0, 100);
    const maf = Math.max(1, 2 + throttle * 0.25 + rpm / 900 + rand(-0.4, 0.4));
    const o2 = clamp(0.45 + 0.35 * Math.sin(t / 1.3), 0.1, 0.9);

    const values: Record<FieldName, number | null> = {
      rpm: round(rpm, 0),
      speed_kmh: round(speed, 0),
      coolant_c: round(coolant, 1),
      maf_g_s: round(maf, 2),
      throttle_pct: round(throttle, 1),
      o2_v: round(o2, 3),
    };
    const age_ms = {} as Record<FieldName, number | null>;
    const supported = {} as Record<FieldName, boolean | null>;
    const stale = {} as Record<FieldName, boolean>;
    for (const f of FIELDS) {
      age_ms[f] = 0;
      supported[f] = true;
      stale[f] = false;
    }

    // Alternate 20 s with no codes / 20 s with two, so both panel states show.
    const showCodes = Math.floor(t / 20) % 2 === 1;

    seq = (seq + 1) % 0xffffffff;
    const env: Envelope = {
      type: "telemetry_update",
      v: 1,
      mode: "mock",
      serial_connected: true,
      stm_link: "fresh",
      last_frame_age_ms: 0,
      received_at: new Date().toISOString(),
      source_session: 1,
      errors: { parse: 0, oversize: 0, decode: 0, seq_gaps: 0 },
      frame: {
        type: "telemetry",
        v: 1,
        seq,
        uptime_ms: Math.floor(performance.now() - t0),
        values,
        age_ms,
        supported,
        stale,
      },
      dtc: {
        status: "ok",
        codes: showCodes ? ["P0301", "P0420"] : [],
        age_ms: 0,
        stale: false,
      },
    };
    onEnvelope(env);
  };

  tick();
  const id = window.setInterval(tick, 100); // 10 Hz
  return () => window.clearInterval(id);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function rand(lo: number, hi: number) {
  return lo + Math.random() * (hi - lo);
}
function round(v: number, d: number) {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}
