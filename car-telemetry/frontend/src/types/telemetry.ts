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

export interface HistoryPoint {
  t: number; // ms since epoch (client clock)
  v: number; // canonical-unit value
}
