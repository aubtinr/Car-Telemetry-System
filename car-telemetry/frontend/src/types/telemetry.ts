// Mirrors the backend envelope exactly (handoff sections 3 & 5).

export type FieldName =
  | "rpm"
  | "speed_kmh"
  | "coolant_c"
  | "maf_g_s"
  | "throttle_pct"
  | "o2_v";

export const FIELD_NAMES: FieldName[] = [
  "rpm",
  "speed_kmh",
  "coolant_c",
  "maf_g_s",
  "throttle_pct",
  "o2_v",
];

export type StmLink = "fresh" | "stale" | "disconnected";
export type Mode = "live" | "mock";

export interface TelemetryFrame {
  type: "telemetry";
  v: number;
  seq: number | null;
  uptime_ms: number | null;
  values: Record<FieldName, number | null>;
  age_ms: Record<FieldName, number | null>;
  supported: Record<FieldName, boolean | null>;
  stale?: Record<FieldName, boolean>;
}

export interface Errors {
  parse: number;
  oversize: number;
  decode: number;
  seq_gaps: number;
}

// pending = no DTC check yet; no_response = no ECU answered the last check.
export type DtcStatus = "pending" | "ok" | "no_response";

export interface DtcInfo {
  status: DtcStatus;
  codes: string[]; // e.g. "P0301"
  age_ms: number | null; // since the last check
  stale: boolean;
}

export interface Envelope {
  type: "telemetry_update";
  v: number;
  mode: Mode;
  serial_connected: boolean;
  stm_link: StmLink;
  last_frame_age_ms: number | null;
  received_at: string | null;
  source_session: number;
  errors: Errors;
  frame: TelemetryFrame | null;
  dtc: DtcInfo;
  lap: LapStatus;
}

// ---- Laps (recorded by the backend between Start and Stop) ------------------

export interface LapStatus {
  active: boolean;
  id: number | null;
  started_at: string | null;
  elapsed_ms: number | null;
  distance_km: number | null;
}

export interface FieldStats {
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface LapSummary {
  fields: Record<FieldName, FieldStats>;
  distance_km: number;
  codes: string[];
  recovered?: boolean; // closed on startup after a crash / power loss
}

export interface LapRecord {
  id: number;
  mode: Mode;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  summary: LapSummary | null;
}

export interface LapDetail extends LapRecord {
  sample_count: number;
  samples: { t_ms: number[] } & Record<FieldName, (number | null)[]>;
}

// WebSocket connection state, separate from the STM link state.
export type WsStatus = "connecting" | "open" | "closed";

// Per-field view model after local aging is applied.
export interface FieldState {
  value: number | null; // canonical units (km/h, degC, rpm, g/s, %, V)
  ageMs: number | null; // effective age, advanced locally between messages
  supported: boolean | null;
  stale: boolean;
}

// Trouble-code view model after local aging is applied.
export interface DtcState {
  status: DtcStatus;
  codes: string[];
  ageMs: number | null;
  stale: boolean;
}

// Lap view model; elapsed time advanced locally between messages.
export interface LapState {
  active: boolean;
  id: number | null;
  elapsedMs: number | null;
  distanceKm: number | null;
}

export interface HistoryPoint {
  t: number; // ms since epoch (client clock)
  v: number; // canonical-unit value
}
