/**
 * RACE SESSION MEMORY: remembers the room a player is in, so a page refresh puts
 * them back in their lobby instead of dropping them at the menu.
 *
 * Only the room's invite code is stored (never anything secret), with a time
 * stamp. A saved room older than the room's own lifetime is ignored.
 */

const KEY = 'm0vem1nt.race.lastRoom.v1';
/** Rooms live 2 hours server-side; a saved code is never trusted for longer. */
export const RACE_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface Saved {
  code: string;
  savedAt: number;
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function saveRaceSession(code: string, now = Date.now()): void {
  const s = storage();
  if (!s || !/^[A-Z0-9]{4,8}$/.test(code)) return;
  try {
    s.setItem(KEY, JSON.stringify({ code, savedAt: now } satisfies Saved));
  } catch {
    /* private mode / quota: the feature simply stays off */
  }
}

export function clearRaceSession(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The remembered room code, or null when there is none, it is too old, or it is malformed. */
export function readRaceSession(now = Date.now()): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved> | null;
    if (!parsed || typeof parsed.code !== 'string' || typeof parsed.savedAt !== 'number') return null;
    if (!/^[A-Z0-9]{4,8}$/.test(parsed.code)) return null;
    if (now - parsed.savedAt > RACE_SESSION_MAX_AGE_MS || now < parsed.savedAt - 60_000) {
      clearRaceSession();
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}
