/**
 * READY-SCREEN ACADEMY ENTRY — pure decision logic.
 *
 * The WORLD READY screen offers an UNOBTRUSIVE secondary entry into the SAME
 * Movement Academy the Movement Lab already exposes. This module owns only the
 * decision: is the entry worth showing, what does it read as, and what does it
 * promise. It is DOM-free so the wiring in AnalysisScreen stays thin and the
 * behaviour is directly testable.
 *
 * Rules encoded here:
 *  - The primary ENTER WORLD / PLAY SURF_MODE actions are never touched.
 *  - The entry is secondary (rendered BEFORE the primary CTA, subdued styling).
 *  - It is offered until the Academy has been HONESTLY completed; a partially
 *    played or skipped session keeps offering it.
 *  - The copy is mode-specific: SURF READY points at the surf lesson.
 */

import { ProgressSnapshot, isAcademyComplete } from './MovementAcademyProgress';

export type ReadyCourseVariant = 'NORMAL' | 'SURF';

export interface AcademyEntryContext {
  /** Honest academy progress (see MovementAcademyProgress.loadProgress). */
  progress: ProgressSnapshot;
  /** Which ready world is on screen. */
  variant: ReadyCourseVariant;
}

export interface AcademyEntryDecision {
  /** Whether the secondary entry should be visible at all. */
  visible: boolean;
  /** Button label, PLAYHEAD operator-console style. */
  label: string;
  /** One-line mode-relevant tip shown with the entry. */
  tip: string;
  /** Short accessible description for the button. */
  ariaLabel: string;
}

const NORMAL_DECISION: AcademyEntryDecision = {
  visible: true,
  label: 'LEARN MOVEMENT // ACADEMY',
  tip: 'NEW HERE? THE ACADEMY TEACHES STRAFE, BHOP AND SURF IN FIVE SHORT LESSONS.',
  ariaLabel: 'Open the Movement Academy to learn the basics.'
};

const SURF_DECISION: AcademyEntryDecision = {
  visible: true,
  label: 'SURF BASICS // ACADEMY',
  tip: 'NEW TO SURF? LESSON 04 // SURF WALKS THROUGH RAMP ENTRY, HOLDS AND LANDING.',
  ariaLabel: 'Open the Movement Academy surf lesson.'
};

const HIDDEN: AcademyEntryDecision = {
  visible: false,
  label: '',
  tip: '',
  ariaLabel: ''
};

/**
 * Resolve the ready-screen entry. A completed academy hides the entry so a
 * returning player is not nagged; every other state (fresh, in-progress,
 * skipped) offers the relevant lesson.
 */
export function resolveAcademyEntry(context: AcademyEntryContext): AcademyEntryDecision {
  if (!context || isAcademyComplete(context.progress)) return HIDDEN;
  return context.variant === 'SURF' ? SURF_DECISION : NORMAL_DECISION;
}
