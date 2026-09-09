/**
 * GameSettings - player-tunable options persisted to localStorage, edited from the in-game pause
 * menu's Settings panel. Read by the pawn (camera look sensitivity per aim state) and applied to the
 * audio master bus. Values are plain numbers so the sliders map to them directly.
 */

export interface Settings {
  /** Third-person look sensitivity (maps to DefaultPlayerController.inputSettings.lookSensitivity). */
  tpSensitivity: number;
  /** Look sensitivity while aiming a ranged weapon (RMB). */
  aimSensitivity: number;
  /** Master audio volume, 0..1. */
  volume: number;
}

export const SETTINGS_RANGES = {
  tpSensitivity: { min: 0.005, max: 0.06, step: 0.001 },
  aimSensitivity: { min: 0.005, max: 0.06, step: 0.001 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const;

const DEFAULTS: Settings = { tpSensitivity: 0.02, aimSensitivity: 0.012, volume: 1 };
const KEY = 'pth-settings';

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  let loaded: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) loaded = JSON.parse(raw) as Partial<Settings>;
  } catch { /* ignore — use defaults */ }
  cached = { ...DEFAULTS, ...loaded };
  return cached;
}

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const s = getSettings();
  s[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
