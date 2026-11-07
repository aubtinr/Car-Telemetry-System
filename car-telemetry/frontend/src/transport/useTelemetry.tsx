// Telemetry provider + hook. UI components consume this state and never open a
// socket themselves. It:
//   - connects to /ws/telemetry (or a client-side mock when ?mock=1),
//   - reconnects with capped backoff (1, 2, 4, then 5 s),
//   - ages data locally between messages so staleness advances in real time,
//   - keeps a bounded ~60 s history per field for the trend chart,
//   - invalidates live readings when the WebSocket itself is down.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FIELD_NAMES,
  type DtcState,
  type Envelope,
  type Errors,
  type FieldName,
  type FieldState,
  type HistoryPoint,
  type Mode,
  type StmLink,
  type WsStatus,
} from "../types/telemetry";
import { startClientMock } from "./clientMock";

const HISTORY_MS = 60_000;
const LINK_TIMEOUT_MS = 2000;
const STALE_COOLANT_MS = 5000;
const STALE_DEFAULT_MS = 2000;
const DTC_STALE_MS = 15_000;
const BACKOFF_MS = [1000, 2000, 4000, 5000];

function staleThreshold(field: FieldName): number {
  return field === "coolant_c" ? STALE_COOLANT_MS : STALE_DEFAULT_MS;
}

export interface TelemetryView {
  connected: boolean; // WS open (or client mock active)
  wsStatus: WsStatus;
  mode: Mode | null;
  isMockTransport: boolean; // true = client-side mock, no backend
  link: StmLink; // effective STM link, considering WS health
  serialConnected: boolean;
  sourceSession: number;
  errors: Errors;
  lastFrameAgeMs: number | null; // effective, locally aged
  seq: number | null;
  fields: Record<FieldName, FieldState>;
  history: Record<FieldName, HistoryPoint[]>;
  dtc: DtcState;
}

const emptyFields = (): Record<FieldName, FieldState> => {
  const o = {} as Record<FieldName, FieldState>;
  for (const f of FIELD_NAMES) o[f] = { value: null, ageMs: null, supported: null, stale: false };
  return o;
};
const emptyHistory = (): Record<FieldName, HistoryPoint[]> => {
  const o = {} as Record<FieldName, HistoryPoint[]>;
  for (const f of FIELD_NAMES) o[f] = [];
  return o;
};

const TelemetryContext = createContext<TelemetryView | null>(null);

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const useMock =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("mock") === "1";

  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [tick, setTick] = useState(0); // forces periodic re-render for local aging

  // Latest envelope + the performance-clock time it arrived (for local aging).
  const envRef = useRef<Envelope | null>(null);
  const arrivedRef = useRef<number>(0);
  const historyRef = useRef<Record<FieldName, HistoryPoint[]>>(emptyHistory());

  // ---- ingest one envelope (shared by WS and client mock) -------------------
  const ingest = (env: Envelope) => {
    envRef.current = env;
    arrivedRef.current = performance.now();
    const now = Date.now();
    if (env.frame) {
      for (const f of FIELD_NAMES) {
        const v = env.frame.values[f];
        const supported = env.frame.supported[f];
        if (v !== null && v !== undefined && supported !== false) {
          const arr = historyRef.current[f];
          arr.push({ t: now, v });
          const cutoff = now - HISTORY_MS;
          while (arr.length && arr[0].t < cutoff) arr.shift();
        }
      }
    }
    // Re-render now rather than waiting for the next aging tick.
    setTick((n) => (n + 1) % 1_000_000);
  };

  // ---- transport: client mock ----------------------------------------------
  useEffect(() => {
    if (!useMock) return;
    setWsStatus("open");
    const stop = startClientMock((env) => ingest(env));
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useMock]);

  // ---- transport: WebSocket with capped backoff ----------------------------
  useEffect(() => {
    if (useMock) return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: number | undefined;
    let closedByUs = false;

    const connect = () => {
      setWsStatus(attempt === 0 ? "connecting" : "connecting");
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${scheme}://${window.location.host}/ws/telemetry`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setWsStatus("open");
      };
      ws.onmessage = (ev) => {
        try {
          const env = JSON.parse(ev.data) as Envelope;
          if (env && env.type === "telemetry_update") ingest(env);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        setWsStatus("closed");
        if (closedByUs) return;
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* no-op */
        }
      };
    };

    connect();
    return () => {
      closedByUs = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* no-op */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useMock]);

  // ---- local aging clock: also re-render ~8 Hz between messages -------------
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => (n + 1) % 1_000_000), 125);
    return () => window.clearInterval(id);
  }, []);

  // ---- derive the view model on every render -------------------------------
  const view = useMemo<TelemetryView>(() => {
    const env = envRef.current;
    const sinceArrival = env ? performance.now() - arrivedRef.current : 0;
    const wsOpen = wsStatus === "open";

    const fields = emptyFields();
    let link: StmLink = "disconnected";
    let serialConnected = false;
    let mode: Mode | null = null;
    let errors: Errors = { parse: 0, oversize: 0, decode: 0, seq_gaps: 0 };
    let sourceSession = 0;
    let lastFrameAgeMs: number | null = null;
    let seq: number | null = null;
    let dtc: DtcState = { status: "pending", codes: [], ageMs: null, stale: false };

    if (env) {
      mode = env.mode;
      errors = env.errors;
      serialConnected = env.serial_connected;
      sourceSession = env.source_session;
      seq = env.frame?.seq ?? null;

      lastFrameAgeMs =
        env.last_frame_age_ms === null ? null : env.last_frame_age_ms + sinceArrival;

      // Effective link: the socket being down invalidates everything.
      if (!wsOpen) {
        link = "disconnected";
      } else if (!serialConnected || lastFrameAgeMs === null) {
        link = "disconnected";
      } else if (lastFrameAgeMs > LINK_TIMEOUT_MS) {
        link = "stale";
      } else {
        link = "fresh";
      }

      if (env.dtc) {
        const ageMs = env.dtc.age_ms === null ? null : Math.round(env.dtc.age_ms + sinceArrival);
        dtc = {
          status: env.dtc.status,
          codes: env.dtc.codes,
          ageMs,
          stale: link === "disconnected" || (ageMs !== null && ageMs > DTC_STALE_MS),
        };
      }

      if (env.frame) {
        for (const f of FIELD_NAMES) {
          const baseAge = env.frame.age_ms[f];
          const effAge = baseAge === null ? null : baseAge + sinceArrival;
          const supported = env.frame.supported[f];
          const stale =
            link === "disconnected"
              ? true
              : effAge !== null && effAge > staleThreshold(f);
          fields[f] = {
            value: env.frame.values[f],
            ageMs: effAge === null ? null : Math.round(effAge),
            supported,
            stale: supported === false ? false : stale,
          };
        }
      }
    }

    return {
      connected: wsOpen,
      wsStatus,
      mode,
      isMockTransport: useMock,
      link,
      serialConnected,
      sourceSession,
      errors,
      lastFrameAgeMs: lastFrameAgeMs === null ? null : Math.round(lastFrameAgeMs),
      seq,
      fields,
      history: historyRef.current,
      dtc,
    };
    // Recomputed each render; `tick` is bumped on every envelope and ~8 Hz in
    // between, so ages and staleness advance even while no new envelope arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsStatus, useMock, tick]);

  return <TelemetryContext.Provider value={view}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryView {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error("useTelemetry must be used within <TelemetryProvider>");
  return ctx;
}
