/**
 * WORLD SUBMISSION FEEDBACK — the player-facing truth about a finished run.
 *
 * Shared by the finish path (which knows the real `SubmitOutcome`) and the
 * results screen (which renders it). Kept in its own pure module so the UI does
 * not have to import the game loop.
 *
 * Every state is explicit. Nothing here claims a successful online submission
 * before the server has confirmed it, and nothing says a feature is "coming
 * later" — the copy tracks what actually happened.
 */

export type SubmissionState =
  | 'SUBMITTING'
  | 'WORLD_ENTRY_SUBMITTED'
  | 'WORLD_PB_UPDATED'
  | 'WORLD_ENTRY_QUEUED_OFFLINE'
  | 'WORLD_SUBMISSION_FAILED'
  | 'RUN_INELIGIBLE_NON_CANONICAL'
  | 'RUN_INELIGIBLE_UNRANKED'
  | 'RUN_INELIGIBLE_OVERTIME'
  | 'NOT_OFFICIAL';

export interface SubmissionFeedback {
  state: SubmissionState;
  /** Real reason / server detail, shown only when something did not succeed. */
  detail?: string;
}

export const SUBMISSION_FEEDBACK_TEXT: Record<SubmissionState, string> = {
  SUBMITTING: 'WORLD ENTRY // SUBMITTING...',
  WORLD_ENTRY_SUBMITTED: 'WORLD ENTRY // SUBMITTED',
  WORLD_PB_UPDATED: 'WORLD PB // UPDATED',
  WORLD_ENTRY_QUEUED_OFFLINE: 'WORLD ENTRY // QUEUED - OFFLINE',
  WORLD_SUBMISSION_FAILED: 'WORLD SUBMISSION // FAILED',
  RUN_INELIGIBLE_NON_CANONICAL: 'RUN INELIGIBLE // NON-CANONICAL MAP',
  RUN_INELIGIBLE_UNRANKED: 'RUN INELIGIBLE // UNRANKED',
  RUN_INELIGIBLE_OVERTIME: 'RUN INELIGIBLE // OVERTIME',
  NOT_OFFICIAL: 'LOCAL RUN // NOT AN OFFICIAL SIGNAL'
};

/** True when the run did not reach the world board and can still be retried. */
export function isRetryableSubmission(state: SubmissionState): boolean {
  return state === 'WORLD_ENTRY_QUEUED_OFFLINE' || state === 'WORLD_SUBMISSION_FAILED';
}

/** True when the run is on the world board. */
export function isSubmittedToWorld(state: SubmissionState): boolean {
  return state === 'WORLD_ENTRY_SUBMITTED' || state === 'WORLD_PB_UPDATED';
}
