// Unit system + per-field display conversion/formatting.
// The wire data is always metric/canonical; this layer only affects display.

import type { FieldName } from "../types/telemetry";

export type UnitSystem = "metric" | "imperial";

export interface Display {
  value: string; // formatted number, or "—"
  unit: string; // display unit
  // Numeric value in *display* units (for gauge sweep). null when no data.
  display: number | null;
  min: number;
  max: number;
  // Fraction of the way from min..max, clamped to [0,1]. null when no data.
  fraction: number | null;
}

interface FieldMeta {
  label: string;
  // metric unit + range
  metricUnit: string;
  metricMin: number;
  metricMax: number;
  // imperial unit + range (same field; some have no imperial variant)
  imperialUnit: string;
  imperialMin: number;
  imperialMax: number;
  toImperial: (v: number) => number;
  decimals: number; // for display formatting
  // optional "warning zone" start as a fraction of the range (e.g. redline)
  warnFraction?: number;
}

const kmhToMph = (v: number) => v * 0.621371;
const cToF = (v: number) => v * 9 / 5 + 32;
const identity = (v: number) => v;

export const FIELD_META: Record<FieldName, FieldMeta> = {
  rpm: {
    label: "RPM",
    metricUnit: "rpm",
    metricMin: 0,
    metricMax: 7000,
    imperialUnit: "rpm",
    imperialMin: 0,
    imperialMax: 7000,
    toImperial: identity,
    decimals: 0,
    warnFraction: 6000 / 7000,
  },
  speed_kmh: {
    label: "Speed",
    metricUnit: "km/h",
    metricMin: 0,
    metricMax: 180,
    imperialUnit: "mph",
    imperialMin: 0,
    imperialMax: 120,
    toImperial: kmhToMph,
    decimals: 0,
  },
  coolant_c: {
    label: "Coolant",
    metricUnit: "°C",
    metricMin: 40,
    metricMax: 120,
    imperialUnit: "°F",
    imperialMin: 100,
    imperialMax: 250,
    toImperial: cToF,
    decimals: 0,
    warnFraction: (110 - 40) / (120 - 40),
  },
  maf_g_s: {
    label: "MAF",
    metricUnit: "g/s",
    metricMin: 0,
    metricMax: 60,
    imperialUnit: "g/s",
    imperialMin: 0,
    imperialMax: 60,
    toImperial: identity,
    decimals: 1,
  },
  throttle_pct: {
    label: "Throttle",
    metricUnit: "%",
    metricMin: 0,
    metricMax: 100,
    imperialUnit: "%",
    imperialMin: 0,
    imperialMax: 100,
    toImperial: identity,
    decimals: 0,
  },
  o2_v: {
    label: "O₂ (B1S1)",
    metricUnit: "V",
    metricMin: 0,
    metricMax: 1.0,
    imperialUnit: "V",
    imperialMin: 0,
    imperialMax: 1.0,
    toImperial: identity,
    decimals: 2,
  },
};

export function fieldLabel(field: FieldName): string {
  return FIELD_META[field].label;
}

export function unitFor(field: FieldName, system: UnitSystem): string {
  const m = FIELD_META[field];
  return system === "imperial" ? m.imperialUnit : m.metricUnit;
}

export function toDisplay(
  field: FieldName,
  canonical: number | null,
  system: UnitSystem,
): Display {
  const m = FIELD_META[field];
  const imperial = system === "imperial";
  const unit = imperial ? m.imperialUnit : m.metricUnit;
  const min = imperial ? m.imperialMin : m.metricMin;
  const max = imperial ? m.imperialMax : m.metricMax;

  if (canonical === null || Number.isNaN(canonical)) {
    return { value: "—", unit, display: null, min, max, fraction: null };
  }
  const display = imperial ? m.toImperial(canonical) : canonical;
  const fraction = Math.max(0, Math.min(1, (display - min) / (max - min)));
  const value = display.toLocaleString(undefined, {
    minimumFractionDigits: m.decimals,
    maximumFractionDigits: m.decimals,
  });
  return { value, unit, display, min, max, fraction };
}

export function warnFraction(field: FieldName): number | undefined {
  return FIELD_META[field].warnFraction;
}
