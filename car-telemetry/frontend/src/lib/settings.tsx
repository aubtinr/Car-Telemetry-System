// Display settings (theme, layout, units, dashboard view), remembered in this browser.
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

export type ThemeId =
  | "midnight"
  | "daylight"
  | "ember"
  | "track"
  | "night"
  | "neon"
  | "sunset"
  | "purple"
  | "rally"
  | "sakura"
  | "lcd"
  | "redzone"
  | "pearl";
export type LayoutMode = "auto" | "landscape" | "portrait";
export type Orientation = "landscape" | "portrait";
export type ViewId =
  | "classic"
  | "race"
  | "touge"
  | "lcd"
  | "pods"
  | "analog"
  | "hud"
  | "bars"
  | "orbit";

// Dashboard styles, in the order the menu's ‹ › buttons step through them.
export const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "classic", label: "Classic", hint: "Gauges, tiles, codes and trend" },
  { id: "race", label: "Race", hint: "Shift lights + big digital readouts" },
  { id: "touge", label: "Touge", hint: "Neon tach, synthwave road, kanji" },
  { id: "lcd", label: "LCD", hint: "80s/90s digital dash, 7-segment" },
  { id: "pods", label: "Pods", hint: "Glowing gauge pods, peak needles" },
  { id: "analog", label: "Analog", hint: "Needle gauges with tick marks" },
  { id: "hud", label: "HUD", hint: "Huge speed, minimal, mirror option" },
  { id: "bars", label: "Bars", hint: "Every sensor as a bar, with peaks" },
  { id: "orbit", label: "Orbit", hint: "Sensor rings around the speed" },
];

// swatch = [background, accent], used for the picker buttons only.
export const THEMES: { id: ThemeId; label: string; hint: string; swatch: [string, string] }[] = [
  { id: "midnight", label: "Midnight", hint: "Default dark", swatch: ["#0b0e13", "#35c7e8"] },
  { id: "daylight", label: "Daylight", hint: "Bright, for sun", swatch: ["#eef1f5", "#0a72c2"] },
  { id: "ember", label: "Ember", hint: "Dark, orange", swatch: ["#0f0b0a", "#ff8a3d"] },
  { id: "track", label: "Track", hint: "Dark, lime", swatch: ["#090c0a", "#b6f23d"] },
  { id: "night", label: "Night", hint: "Dim, low glare", swatch: ["#000000", "#c9792b"] },
  { id: "neon", label: "Neon Tokyo", hint: "Magenta + cyan", swatch: ["#0a0614", "#ff2bd6"] },
  { id: "sunset", label: "Vapor Sunset", hint: "Orange + pink", swatch: ["#120a1a", "#ff7a45"] },
  { id: "purple", label: "Midnight Purple", hint: "Deep violet", swatch: ["#0c0a14", "#9d7bff"] },
  { id: "rally", label: "Rally Blue", hint: "Blue + gold", swatch: ["#050d1f", "#ffc21a"] },
  { id: "sakura", label: "Sakura", hint: "Soft pink", swatch: ["#160d12", "#ff9cc8"] },
  { id: "lcd", label: "LCD Green", hint: "Retro digital", swatch: ["#050a05", "#7dff4a"] },
  { id: "redzone", label: "Red Zone", hint: "Black + red", swatch: ["#0a0505", "#ff2a2a"] },
  { id: "pearl", label: "Pearl White", hint: "Light, red accent", swatch: ["#f2f2ef", "#d4001a"] },
];

interface Settings {
  theme: ThemeId;
  layout: LayoutMode;
  units: UnitSystem;
  view: ViewId;
  hudMirror: boolean; // HUD view flipped for reading as a windshield reflection
}

const DEFAULTS: Settings = {
  theme: "midnight",
  layout: "auto",
  units: "imperial",
  view: "classic",
  hudMirror: false,
};
const STORAGE_KEY = "ct.settings.v1";

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s: Settings = { ...DEFAULTS, ...JSON.parse(raw) };
      if (!VIEWS.some((v) => v.id === s.view)) s.view = DEFAULTS.view;
      if (!THEMES.some((th) => th.id === s.theme)) s.theme = DEFAULTS.theme;
      return s;
    }
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
