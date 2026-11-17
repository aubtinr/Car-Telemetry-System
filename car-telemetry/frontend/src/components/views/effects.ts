// Small animation helpers shared by the gauge views.

import { useEffect, useState } from "react";
import type { HistoryPoint } from "../../types/telemetry";

// "Opening ceremony" like aftermarket gauges: when a view opens, needles sweep
// to full scale and back. Returns the forced fraction (0..1) while sweeping,
// then null so the real reading takes over.
export function useStartupSweep(durationMs = 1600): number | null {
  const [frac, setFrac] = useState<number | null>(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = (now - t0) / durationMs;
      if (k >= 1) {
        setFrac(null);
        return;
      }
      const half = k < 0.5 ? k * 2 : (1 - k) * 2; // up, then back down
      setFrac(1 - (1 - half) ** 3); // ease-out
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);
  return frac;
}

// Highest canonical value in the recent history window, or null.
export function peakOf(history: HistoryPoint[], windowMs: number): number | null {
  const now = Date.now();
  let best: number | null = null;
  for (const p of history) {
    if (now - p.t <= windowMs && (best === null || p.v > best)) best = p.v;
  }
  return best;
}
