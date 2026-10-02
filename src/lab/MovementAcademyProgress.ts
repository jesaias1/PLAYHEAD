/**
 * MOVEMENT ACADEMY — LESSON DEFINITIONS, PROGRESS AND PERSISTENCE
 *
 * Pure, framework-free and DOM-free. Completion is NEVER decided here: this
 * module only tracks which lessons have been honestly COMPLETED, which were
 * SKIPPED, and which lesson is active. Real skill evidence is observed by
 * `MovementAcademyObserver` from the authoritative fixed-tick controller.
 *
 * Navigation is strictly ORDINAL: skip/complete always advances to the NEXT
 * lesson after the current one (never back to the lesson that was just
 * actioned, and never trapped by an earlier SKIPPED lesson).
 */

export type LessonId = 'MOVEMENT' | 'AIR_STRAFE' | 'BHOP' | 'SURF' | 'FLOW';

export interface Vec3Like { x: number; y: number; z: number }

export interface LessonAnchor {
  id: LessonId;
  spawn: Vec3Like;
  spawnYaw: number;
  /** Forward completion band along Z (>= for forward lessons, <= when reversed). */
  goalMinZ: number;
  reversed?: boolean;
  /** Optional lateral gate centred on this X (used by the strafe lesson). */
  goalX?: number;
  goalRadius?: number;
  /** Attempt fails if the player drops to/below this Y without void restore. */
  goalY?: number;
  /** Minimum display-unit horizontal speed required at the goal. */
  minSpeedUnits: number;
}

export const ACADEMY_LESSON_ORDER: LessonId[] = ['MOVEMENT', 'AIR_STRAFE', 'BHOP', 'SURF', 'FLOW'];

export const ACADEMY_LESSON_TITLES: Record<LessonId, string> = {
  MOVEMENT: '01 // MOVEMENT',
  AIR_STRAFE: '02 // AIR STRAFE',
  BHOP: '03 // BHOP',
  SURF: '04 // SURF',
  FLOW: '05 // FLOW'
};

export const ACADEMY_LESSON_SHORT: Record<LessonId, string> = {
  MOVEMENT: 'MOVEMENT',
  AIR_STRAFE: 'AIR STRAFE',
  BHOP: 'BHOP',
  SURF: 'SURF',
  FLOW: 'FLOW'
};

export type LessonProgress = 'LOCKED' | 'ACTIVE' | 'COMPLETE' | 'SKIPPED';

export interface ProgressSnapshot {
  lessons: Record<LessonId, LessonProgress>;
  active: LessonId;
}

export interface TransitionResult {
  progress: ProgressSnapshot;
  completedEdit: boolean;
  skippedEdit: boolean;
  /** The session has reached its end (FLOW completed OR skipped). */
  sessionFinished: boolean;
}

export function createProgress(): ProgressSnapshot {
  return {
    lessons: {
      MOVEMENT: 'ACTIVE',
      AIR_STRAFE: 'LOCKED',
      BHOP: 'LOCKED',
      SURF: 'LOCKED',
      FLOW: 'LOCKED'
    },
    active: 'MOVEMENT'
  };
}

function nextOrdinal(id: LessonId): LessonId | null {
  const idx = ACADEMY_LESSON_ORDER.indexOf(id);
  if (idx < 0 || idx >= ACADEMY_LESSON_ORDER.length - 1) return null;
  return ACADEMY_LESSON_ORDER[idx + 1];
}

/** First lesson strictly after `afterId` that is not COMPLETE. */
function firstIncompleteAfter(
  lessons: Record<LessonId, LessonProgress>,
  afterId: LessonId
): LessonId | null {
  const start = ACADEMY_LESSON_ORDER.indexOf(afterId) + 1;
  for (let i = start; i < ACADEMY_LESSON_ORDER.length; i++) {
    const id = ACADEMY_LESSON_ORDER[i];
    if (lessons[id] !== 'COMPLETE') return id;
  }
  return null;
}

function activate(progress: ProgressSnapshot, id: LessonId): void {
  progress.active = id;
  if (progress.lessons[id] === 'LOCKED' || progress.lessons[id] === 'SKIPPED') {
    progress.lessons[id] = 'ACTIVE';
  }
}

/** Honest completion: every lesson is COMPLETE (skips do not count). */
export function isAcademyComplete(progress: ProgressSnapshot): boolean {
  return ACADEMY_LESSON_ORDER.every((id) => progress.lessons[id] === 'COMPLETE');
}

/** The session is finished once FLOW has been completed or skipped. */
export function isSessionFinished(progress: ProgressSnapshot): boolean {
  return progress.lessons.FLOW === 'COMPLETE' || progress.lessons.FLOW === 'SKIPPED';
}

export function completeLesson(progress: ProgressSnapshot, id: LessonId): TransitionResult {
  const lessons = { ...progress.lessons };
  lessons[id] = 'COMPLETE';
  const next: ProgressSnapshot = { lessons, active: progress.active };
  const nextId = firstIncompleteAfter(lessons, id);
  if (nextId) {
    activate(next, nextId);
  } else {
    next.active = id;
  }
  return {
    progress: next,
    completedEdit: true,
    skippedEdit: false,
    sessionFinished: isSessionFinished(next)
  };
}

export function skipLesson(progress: ProgressSnapshot, id: LessonId): TransitionResult {
  const lessons = { ...progress.lessons };
  if (lessons[id] !== 'COMPLETE') lessons[id] = 'SKIPPED';
  const next: ProgressSnapshot = { lessons, active: progress.active };
  // Advance by ORDINAL to the next lesson, never back onto the skipped one.
  const nextId = nextOrdinal(id);
  if (nextId) {
    activate(next, nextId);
  } else {
    next.active = id;
  }
  return {
    progress: next,
    completedEdit: false,
    skippedEdit: true,
    sessionFinished: isSessionFinished(next)
  };
}

/**
 * True when the player may jump directly to `id`. After the session is
 * finished (FLOW completed or skipped) every lesson is replayable.
 */
export function isSelectable(progress: ProgressSnapshot, id: LessonId): boolean {
  if (isSessionFinished(progress)) return true;
  if (progress.active === id) return true;
  return progress.lessons[id] === 'COMPLETE';
}

/** Direct lesson selection (replay / skip-around). Returns a new snapshot. */
export function selectLesson(progress: ProgressSnapshot, id: LessonId): ProgressSnapshot {
  const next: ProgressSnapshot = { lessons: { ...progress.lessons }, active: progress.active };
  activate(next, id);
  return next;
}

// ---------------------------------------------------------------------------
// Local persistence — defensive: never throws, never trusts stored shape.
// ---------------------------------------------------------------------------

export const ACADEMY_STORAGE_KEY = 'playhead.movementAcademy.v1';

function isLessonId(value: unknown): value is LessonId {
  return typeof value === 'string' && (ACADEMY_LESSON_ORDER as string[]).includes(value);
}

function isLessonProgress(value: unknown): value is LessonProgress {
  return value === 'COMPLETE' || value === 'SKIPPED' || value === 'ACTIVE' || value === 'LOCKED';
}

export function loadProgress(storage?: Pick<Storage, 'getItem'> | null): ProgressSnapshot {
  const fresh = createProgress();
  try {
    const raw = storage?.getItem(ACADEMY_STORAGE_KEY);
    if (!raw || typeof raw !== 'string') return fresh;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return fresh;
    const lessonsRaw = (parsed as { lessons?: unknown }).lessons;
    if (!lessonsRaw || typeof lessonsRaw !== 'object') return fresh;

    const lessons: Record<LessonId, LessonProgress> = { ...fresh.lessons };
    for (const id of ACADEMY_LESSON_ORDER) {
      const value = (lessonsRaw as Record<string, unknown>)[id];
      if (isLessonProgress(value)) lessons[id] = value;
    }

    const activeRaw = (parsed as { active?: unknown }).active;
    let active: LessonId = isLessonId(activeRaw) ? activeRaw : fresh.active;
    // A stored ACTIVE lesson that is actually COMPLETE (from a full clear) must
    // not re-trigger that lesson — surface the honest state instead.
    if (isAcademyComplete({ lessons, active })) {
      active = 'FLOW';
    } else if (lessons[active] === 'COMPLETE') {
      const fallback = ACADEMY_LESSON_ORDER.find((id) => lessons[id] !== 'COMPLETE');
      if (fallback) active = fallback;
    } else if (lessons[active] === 'LOCKED') {
      lessons[active] = 'ACTIVE';
    }

    return { lessons, active };
  } catch {
    return fresh;
  }
}

export function saveProgress(
  progress: ProgressSnapshot,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  try {
    storage?.setItem(
      ACADEMY_STORAGE_KEY,
      JSON.stringify({ lessons: progress.lessons, active: progress.active })
    );
  } catch {
    // Persistence is a convenience; a full/blocked storage must never break play.
  }
}
