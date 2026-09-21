/**
 * Game settings with localStorage persistence
 */

export type GhostMode = 'ALL' | 'PB_ONLY' | 'RIVAL_ONLY' | 'OFF';
export type ViewmodelMode = 'FULL' | 'MINIMAL' | 'OFF';
export type ViewmodelAccent = 'ADAPTIVE' | 'DEFAULT_CYAN' | 'OFF';
export type TerminalCallouts = 'FULL' | 'MINIMAL' | 'OFF';
/** Unified graphics tier. AUTO scales render cost to sustained performance. */
export type GraphicsTier = 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface GameSettings {
  mouseSensitivity: number;
  fov: number;
  masterVolume: number;
  reduceMotion: boolean;
  holdToBhop: boolean;
  showDebug: boolean;
  /** @deprecated superseded by `graphics`; retained for saved-settings compat. */
  visualQuality: 'SIGNAL' | 'CLEAN' | 'HIGH' | 'PERFORMANCE';
  graphics: GraphicsTier;
  ghostMode: GhostMode;
  viewmodelMode: ViewmodelMode;
  viewmodelAccent: ViewmodelAccent;
  terminalCallouts: TerminalCallouts;
  hideHud: boolean;
  viewmodelFov: number;
  viewmodelSway: number;
  showHints: boolean;
}

export type SettingsKey = keyof GameSettings;
export type SettingsListener = (
  settings: Readonly<GameSettings>,
  changedKeys: ReadonlySet<SettingsKey>
) => void;

const DEFAULT_SETTINGS: GameSettings = {
  mouseSensitivity: 1.0,
  fov: 75,
  masterVolume: 0.8,
  reduceMotion: false,
  holdToBhop: true,
  showDebug: false,
  visualQuality: 'SIGNAL',
  graphics: 'AUTO',
  ghostMode: 'ALL',
  viewmodelMode: 'FULL',
  viewmodelAccent: 'ADAPTIVE',
  terminalCallouts: 'MINIMAL',
  hideHud: false,
  viewmodelFov: 65,
  viewmodelSway: 1.0,
  showHints: true
};

const STORAGE_KEY = 'trackrun_settings';

export class SettingsManager {
  private static instance: SettingsManager;
  public settings: GameSettings;
  private listeners = new Set<SettingsListener>();

  private constructor() {
    this.settings = this.load();
  }

  public static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  private load(): GameSettings {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          return { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch (e) {
      console.warn('[SettingsManager] Failed to load settings from localStorage, using defaults:', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  public save(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      }
    } catch (e) {
      console.warn('[SettingsManager] Failed to save settings to localStorage:', e);
    }
  }

  public update(partial: Partial<GameSettings>): void {
    const changedKeys = (Object.keys(partial) as SettingsKey[])
      .filter(key => partial[key] !== undefined && partial[key] !== this.settings[key]);
    if (changedKeys.length === 0) return;

    this.settings = { ...this.settings, ...partial };
    this.save();

    const changed = new Set(changedKeys);
    for (const listener of this.listeners) {
      try {
        listener(this.settings, changed);
      } catch (error) {
        console.warn('[SettingsManager] Settings listener failed:', error);
      }
    }
  }

  /** Subscribe active runtime consumers to the single persisted settings state. */
  public subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
