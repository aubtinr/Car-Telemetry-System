// Shared per-field readout used by every dashboard view, so they all treat
// live / stale / unsupported / no-data the same way the classic gauges do.

import type { FieldName, FieldState } from "../../types/telemetry";
import { FIELD_META, fieldLabel, toDisplay, type Display, type UnitSystem } from "../../lib/units";

export type ReadStatus = "fresh" | "stale" | "unsupported" | "nodata";

export interface Reading extends Display {
  field: FieldName;
  label: string;
  status: ReadStatus;
  text: string; // value to print ("N/A" when unsupported, "—" with no data)
  note: string; // short state line: unit, "stale · 2.1 s", "no data", ...
  inWarn: boolean; // value is inside the field's warning zone (redline, hot)
}

export function read(field: FieldName, state: FieldState, system: UnitSystem): Reading {
  const d = toDisplay(field, state.value, system);
  const unsupported = state.supported === false;
  const noData = !unsupported && state.value === null;
  const stale = state.stale && !unsupported && !noData;
  const status: ReadStatus = unsupported ? "unsupported" : noData ? "nodata" : stale ? "stale" : "fresh";
  const fraction = unsupported || noData ? null : d.fraction;
  const warn = FIELD_META[field].warnFraction;

  return {
    ...d,
    fraction,
    field,
    label: fieldLabel(field),
    status,
    text: unsupported ? "N/A" : d.value,
    note: unsupported ? "unsupported" : noData ? "no data" : stale ? `stale · ${fmtAge(state.ageMs)}` : d.unit,
    inWarn: fraction !== null && warn !== undefined && fraction >= warn,
  };
}

export function fmtAge(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// Polar helpers for the SVG views (0° = 12 o'clock, clockwise).
export function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  // A full circle can't be one SVG arc; stop just short of it.
  const end = a1 - a0 >= 360 ? a0 + 359.99 : a1;
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, end);
  const large = end - a0 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}
