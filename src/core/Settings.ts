/**
 * Game settings with localStorage persistence
 */

export interface GameSettings {
  mouseSensitivity: number;
  fov: number;
  masterVolume: number;
  reduceMotion: boolean;
  holdToBhop: boolean;
  showDebug: boolean;
  visualQuality: 'HIGH' | 'PERFORMANCE';
}

const DEFAULT_SETTINGS: GameSettings = {
  mouseSensitivity: 1.0,
  fov: 75,
  masterVolume: 0.8,
  reduceMotion: false,
  holdToBhop: true,
  showDebug: false,
  visualQuality: 'HIGH'
};

const STORAGE_KEY = 'trackrun_settings';

export class SettingsManager {
  private static instance: SettingsManager;
  public settings: GameSettings;

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
    this.settings = { ...this.settings, ...partial };
    this.save();
  }
}
