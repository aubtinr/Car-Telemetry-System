// Display settings (theme, layout, units), remembered in this browser.
// The theme is applied as data-theme on <html>; index.css defines each palette.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import type { UnitSystem } from "./units";

export type ThemeId = "midnight" | "daylight" | "ember" | "track" | "night";
export type LayoutMode = "auto" | "landscape" | "portrait";
export type Orientation = "landscape" | "portrait";

// swatch = [background, accent], used for the picker buttons only.
export const THEMES: { id: ThemeId; label: string; hint: string; swatch: [string, string] }[] = [
  { id: "midnight", label: "Midnight", hint: "Default dark", swatch: ["#0b0e13", "#35c7e8"] },
  { id: "daylight", label: "Daylight", hint: "Bright, for sun", swatch: ["#eef1f5", "#0a72c2"] },
  { id: "ember", label: "Ember", hint: "Dark, orange", swatch: ["#0f0b0a", "#ff8a3d"] },
  { id: "track", label: "Track", hint: "Dark, lime", swatch: ["#090c0a", "#b6f23d"] },
  { id: "night", label: "Night", hint: "Dim, low glare", swatch: ["#000000", "#c9792b"] },
];

interface Settings {
  theme: ThemeId;
  layout: LayoutMode;
  units: UnitSystem;
}

const DEFAULTS: Settings = { theme: "midnight", layout: "auto", units: "imperial" };
const STORAGE_KEY = "ct.settings.v1";

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage blocked or corrupt: use defaults */
  }
  return DEFAULTS;
}

interface SettingsView extends Settings {
  orientation: Orientation; // layout after resolving "auto"
  set: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsView | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const [screenPortrait, setScreenPortrait] = useState(
    () => window.matchMedia("(orientation: portrait)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = () => setScreenPortrait(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Before paint, so a saved theme never flashes the default first.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const set = (patch: Partial<Settings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* not persisted; still applies for this session */
      }
      return next;
    });

  const orientation: Orientation =
    settings.layout === "auto" ? (screenPortrait ? "portrait" : "landscape") : settings.layout;

  return (
    <SettingsContext.Provider value={{ ...settings, orientation, set }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsView {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within <SettingsProvider>");
  return ctx;
}
