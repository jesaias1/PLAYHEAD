/**
 * RESULT SHARING — pure model + side-effect boundaries.
 *
 * A finished run is IMMUTABLE: once the report is on screen its time, rank and
 * mode never change. Sharing therefore SNAPSHOTS that finished state into a
 * plain model and renders from the snapshot only. Nothing here re-reads live
 * game state, recalculates a rank, or touches the next attempt's candidate.
 *
 * Side effects (canvas, navigator.share, clipboard, download) sit behind the
 * small injectable interfaces below so the behaviour is directly testable and
 * the UI layer never silently uploads anything. Sharing is exclusively
 * user-initiated: nothing runs until the player clicks SHARE RESULT.
 */

import type { RunResults } from '../player/PlayerStats';

export type ShareVariant = 'NORMAL' | 'SURF' | 'OFFICIAL' | 'CUSTOM';

export interface ShareContext {
  results: RunResults;
  trackTitle: string;
  mode: 'NORMAL' | 'SURF';
  /** Trusted official Signal Pack track (canonical map). */
  isOfficial: boolean;
  /** Player-supplied custom audio: never publicly webbed, never uploaded. */
  isCustomAudio: boolean;
  isOvertime: boolean;
  /** Only true when the server CONFIRMED the world entry for THIS run. */
  submittedToWorld: boolean;
  /** Optional server-confirmed position, shown only when actually known. */
  worldPosition?: number | null;
}

export interface ShareCardModel {
  variant: ShareVariant;
  accent: string;
  accentDim: string;
  kicker: string;
  title: string;
  trackLine: string;
  modeLine: string;
  rankLine: string;
  timeLine: string;
  statLines: string[];
  footerLine: string;
  verificationLine: string;
  url: string;
  text: string;
}

/** Existing production host. No backend, no deep-link contract assumed. */
export const PLAYHEAD_SHARE_URL = 'https://playhead-sooty.vercel.app/';

/** PLAYHEAD identity: cyan is the normal signal; surf is a subdued violet. */
export const SHARE_ACCENT_NORMAL = '#00f0ff';
export const SHARE_ACCENT_SURF = '#9a8cff';
export const SHARE_ACCENT_NORMAL_DIM = 'rgba(0, 240, 255, 0.18)';
export const SHARE_ACCENT_SURF_DIM = 'rgba(154, 140, 255, 0.16)';

export function resolveShareVariant(ctx: Pick<ShareContext, 'mode' | 'isOfficial' | 'isCustomAudio'>): ShareVariant {
  if (ctx.mode === 'SURF') return 'SURF';
  if (ctx.isCustomAudio) return 'CUSTOM';
  if (ctx.isOfficial) return 'OFFICIAL';
  return 'NORMAL';
}

export function resolveShareAccent(variant: ShareVariant): { accent: string; accentDim: string } {
  return variant === 'SURF'
    ? { accent: SHARE_ACCENT_SURF, accentDim: SHARE_ACCENT_SURF_DIM }
    : { accent: SHARE_ACCENT_NORMAL, accentDim: SHARE_ACCENT_NORMAL_DIM };
}

function pad2(n: number): string { return n.toString().padStart(2, '0'); }

/** mm:ss.mmm — matches the on-screen report, computed from the finished run. */
export function formatShareTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---';
  const totalMs = Math.round(seconds * 1000);
  const whole = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${pad2(m)}:${pad2(s)}.${ms.toString().padStart(3, '0')}`;
}

function signedSeconds(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '-';
  return `${sign}${Math.abs(seconds).toFixed(2)}s`;
}

/**
 * Freeze the finished run into the share model. `results.rank` is used VERBATIM:
 * the share card never re-derives a rank, so it cannot disagree with the report.
 */
export function buildShareCardModel(ctx: ShareContext): ShareCardModel {
  const variant = resolveShareVariant(ctx);
  const { accent, accentDim } = resolveShareAccent(variant);
  const isUnranked = ctx.results.rank === 'UNRANKED';
  const rank = isUnranked ? 'UNRANKED' : ctx.results.rank;

  const modeLabel =
    variant === 'SURF' ? (ctx.isCustomAudio ? 'SURF // CUSTOM AUDIO' : 'SURF')
    : variant === 'CUSTOM' ? 'CUSTOM AUDIO'
    : 'NORMAL';

  const timeLine = formatShareTime(ctx.results.completionTime);

  // Honest verification copy: only a server-confirmed entry claims the board.
  // A custom-audio or overtime run is explicitly LOCAL so a link never poses as
  // a verified leaderboard run.
  let verificationLine: string;
  if (ctx.isCustomAudio) {
    verificationLine = 'LOCAL RUN // CUSTOM AUDIO // NOT SUBMITTED';
  } else if (ctx.isOvertime) {
    verificationLine = 'LOCAL RUN // OVERTIME // NOT SUBMITTED';
  } else if (ctx.submittedToWorld) {
    verificationLine = 'WORLD BOARD ENTRY // ACCEPTED';
  } else if (variant === 'SURF') {
    verificationLine = 'SURF WORLD BOARD // WORLD ENTRY NOT CONFIRMED';
  } else {
    verificationLine = 'LOCAL REPORT // WORLD ENTRY NOT CONFIRMED';
  }

  const statLines = [
    `SYNC  ${signedSeconds(ctx.results.syncDelta)}`,
    `SCORE ${ctx.results.score.toLocaleString()}`,
    `MAX   ${Math.round(ctx.results.maxSpeed)} u/s`,
    `STRAFE ${ctx.results.strafeEfficiency >= 0 ? `${ctx.results.strafeEfficiency}%` : '—'}`
  ];

  const title = ctx.trackTitle.trim() ? ctx.trackTitle.trim().toUpperCase() : 'PLAYHEAD TRACK';
  const rankLine = isUnranked ? 'RANK // UNRANKED' : `RANK // ${rank}`;

  const text = [
    'PLAYHEAD // RUN REPORT',
    `TRACK // ${title}`,
    `MODE  // ${modeLabel}`,
    rankLine,
    `TIME  // ${timeLine}`,
    ...statLines,
    verificationLine,
    PLAYHEAD_SHARE_URL
  ].join('\n');

  return {
    variant,
    accent,
    accentDim,
    kicker: 'PLAYHEAD // RUN REPORT',
    title,
    trackLine: `TRACK // ${title}`,
    modeLine: `MODE  // ${modeLabel}`,
    rankLine,
    timeLine,
    statLines,
    footerLine: 'PLAYHEAD — YOUR MUSIC, AS A PLACE',
    verificationLine,
    url: PLAYHEAD_SHARE_URL,
    text
  };
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/** Minimal 2D context surface used for the card, so a fake context is easy. */
export interface ShareCardCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save?(): void;
  restore?(): void;
}

/**
 * Draw the card into any 2D context of size SHARE_CARD_WIDTH x SHARE_CARD_HEIGHT.
 * Code-native PLAYHEAD console UI: dark panel, accent rule, mono type stack.
 * Returns the list of drawn text runs (used by tests to prove content, not just
 * that *something* was painted).
 */
export function drawShareCard(canvas: ShareCardCanvasContext, model: ShareCardModel): string[] {
  const drawn: string[] = [];
  const paint = (value: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left') => {
    canvas.font = font;
    canvas.fillStyle = color;
    canvas.textAlign = align;
    canvas.fillText(value, x, y);
    drawn.push(value);
  };

  canvas.fillStyle = '#07090d';
  canvas.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // Accent left rule — the single strongest mode cue.
  canvas.fillStyle = model.accent;
  canvas.fillRect(0, 0, 10, SHARE_CARD_HEIGHT);

  canvas.textBaseline = 'alphabetic';

  paint(model.kicker, 72, 96, '600 26px "Space Mono", monospace', 'rgba(148, 163, 184, 0.9)');
  canvas.font = '700 62px "Space Mono", monospace';
  let title = model.title;
  while (title.length > 1 && canvas.measureText(title + '…').width > 1056) title = title.slice(0, -1);
  paint(title === model.title ? title : title + '…', 72, 190, canvas.font, '#f4f7ff');
  paint(model.modeLine, 72, 246, '500 26px "Space Mono", monospace', model.accent);

  // Rank + time as the two primary readouts.
  paint(model.rankLine.replace('RANK // ', ''), 72, 396, '700 54px "Space Mono", monospace', model.accent);
  paint('RANK', 72, 434, '500 22px "Space Mono", monospace', 'rgba(148, 163, 184, 0.75)');
  paint(model.timeLine, 1128, 396, '700 76px "Space Mono", monospace', '#f4f7ff', 'right');
  paint('COMPLETION TIME', 1128, 434, '500 22px "Space Mono", monospace', 'rgba(148, 163, 184, 0.75)', 'right');

  // Stat strip.
  let x = 72;
  for (const line of model.statLines) {
    paint(line, x, 500, '500 24px "Space Mono", monospace', 'rgba(203, 213, 225, 0.92)');
    x += 268;
  }

  paint(model.verificationLine, 72, 558, '500 20px "Space Mono", monospace', model.accent);
  paint(model.footerLine, 72, 600, '500 18px "Space Mono", monospace', 'rgba(148, 163, 184, 0.8)');

  return drawn;
}

// ---------------------------------------------------------------------------
// Side-effect boundary: perform the share
// ---------------------------------------------------------------------------

export interface ShareFileLike {
  readonly name: string;
  readonly type: string;
}

export type ShareOutcomeState =
  | 'SHARED'
  | 'DOWNLOADED'
  | 'CANCELLED'
  | 'FAILED';

export interface ShareOutcome {
  state: ShareOutcomeState;
  copied: boolean;
  downloaded: boolean;
  detail?: string;
}

export interface ShareDeps {
  onProgress?: (stage: 'RENDERING' | 'SHARING' | 'COPYING') => void;
  /** navigator.share, unbound-safe. */
  share?: (data: { files?: ShareFileLike[]; text: string; url: string; title: string }) => Promise<void>;
  canShare?: (data: { files: ShareFileLike[] }) => boolean;
  writeText?: (text: string) => Promise<void>;
  /** Trigger a browser download of the PNG blob. */
  download?: (blob: Blob, filename: string) => void;
  /** Produce the PNG blob (may reject on a tainted/unsupported canvas). */
  renderPng?: () => Promise<Blob>;
  makeFileName?: (model: ShareCardModel) => string;
}

export function defaultShareFileName(model: ShareCardModel): string {
  const slug = model.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'playhead';
  return `playhead-${slug}-${model.variant.toLowerCase()}.png`;
}

/**
 * Perform the user-initiated share.
 *
 * Priority:
 *  1. Native file sharing (navigator.share WITH files) — called only here, and
 *     only from a user gesture. A user cancel resolves as CANCELLED, not error.
 *  2. Otherwise: download the PNG and copy the text. Clipboard/download failure
 *     is reported HONESTLY (never claimed as success).
 */
export async function performResultShare(
  model: ShareCardModel,
  deps: ShareDeps
): Promise<ShareOutcome> {
  const fileName = (deps.makeFileName ?? defaultShareFileName)(model);
  let blob: Blob | null = null;
  deps.onProgress?.('RENDERING');
  try {
    if (deps.renderPng) blob = await deps.renderPng();
  } catch (err) {
    blob = null;
  }

  const file: ShareFileLike | null = blob && typeof File !== 'undefined'
    ? new File([blob], fileName, { type: 'image/png' })
    : null;

  let canNativeShare = false;
  try {
    canNativeShare = !!deps.share && !!file && !!deps.canShare?.({ files: [file] });
  } catch { /* Unsupported file sharing uses the download fallback. */ }

  if (canNativeShare && deps.share) {
    deps.onProgress?.('SHARING');
    try {
      await deps.share({ files: [file!], text: model.text, url: model.url, title: 'PLAYHEAD RUN REPORT' });
      return { state: 'SHARED', copied: false, downloaded: false };
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError') {
        // The user cancelled the OS sheet: not a failure, no fallback spam.
        return { state: 'CANCELLED', copied: false, downloaded: false };
      }
      // NotAllowedError / DataError etc: fall through to the fallback path.
    }
  }

  // Fallback: download the card (if we have one) and copy the summary text.
  let copied = false;
  let downloaded = false;
  const failures: string[] = [];

  if (blob && deps.download) {
    try {
      deps.download(blob, fileName);
      downloaded = true;
    } catch {
      failures.push('DOWNLOAD FAILED');
    }
  } else if (!blob) {
    failures.push('CARD RENDER FAILED');
  }

  if (deps.writeText) {
    deps.onProgress?.('COPYING');
    let clipboardTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.writeText(model.text),
        new Promise<never>((_, reject) => { clipboardTimer = setTimeout(() => reject(new Error('clipboard timed out')), 2000); })
      ]);
      copied = true;
    } catch {
      failures.push('CLIPBOARD BLOCKED');
    } finally {
      if (clipboardTimer) clearTimeout(clipboardTimer);
    }
  }

  if (downloaded || copied) {
    return {
      state: 'DOWNLOADED',
      copied,
      downloaded,
      detail: failures.length ? failures.join(' // ') : undefined
    };
  }
  return { state: 'FAILED', copied, downloaded, detail: failures.join(' // ') || 'SHARE FAILED' };
}
