/**
 * Build identifier.
 *
 * `__BUILD_SHA__` is injected by Vite at build time (see vite.config.ts) and is
 * never hardcoded. Falls back to "DEV" when git/build metadata is unavailable.
 */
declare const __BUILD_SHA__: string | undefined;

export const BUILD_SHA: string =
  typeof __BUILD_SHA__ !== 'undefined' && __BUILD_SHA__ ? __BUILD_SHA__ : 'DEV';

/** Short, display-ready build tag, e.g. "BUILD 807e8bb". */
export const BUILD_LABEL = `BUILD ${BUILD_SHA}`;
