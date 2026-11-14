import type { GoalActionKind } from '@/schemas/goal-lifecycle';

/**
 * The goal cancel / complete strings shared by the in-sheet steps (their own
 * wording lives in goal-cancel-step-copy.ts and goal-complete-step-copy.ts).
 * The old full-page review text, which promised interest back on an early
 * cancel, went with that screen.
 */
export const GOAL_LIFECYCLE_COPY = {
  cancel: {
    entryButton: 'Cancel goal',
    entryLabel: 'Cancel savings goal',
    successTitle: 'Goal cancelled',
    rejected:
      'This cancellation was not completed. Your savings are still in your goal.',
  },
  complete: {
    entryButton: 'Complete goal',
    entryLabel: 'Complete savings goal',
    successTitle: 'Goal completed',
    rejected:
      'This goal was not completed. Your savings are still in your goal.',
  },
  savedSoFar: 'Saved so far',
  backToWallet: 'Back to wallet',
  pending: 'We are still processing this. You can safely leave this screen.',
  stillProcessing: 'Still processing',
  checkAgain: 'Check again',
  pinCancelled: 'PIN cancelled. Nothing was changed.',
  nothingChanged: 'Nothing was changed.',
  generic: 'Something went wrong. Please try again.',
  walletLoadFailed: "We couldn't load your wallet. Please try again.",
  signIn: 'Sign in',
  signedOut: 'Please sign in again to continue.',
  checking: 'Checking…',
  tryAgain: 'Try again',
  startAgain: 'Start again',
  needsReview: "Your savings are safe. Please don't try again while we check.",
} as const;

export const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;

// Codes the goal-cancel / goal-complete routes send with copy written for the
// customer. Any other error (network, parse, schema, a code from elsewhere)
// carries text that is not meant to be read, so it is never shown.
const SAFE_SERVER_CODES: ReadonlySet<string> = new Set([
  'GOAL_NEEDS_REVIEW',
  'GOAL_NOT_FOUND',
  'GOAL_NOT_SET_UP',
  'NOTHING_TO_REFUND',
  'NOTHING_TO_MOVE',
  'AMOUNT_TOO_LARGE',
  'WALLET_UNAVAILABLE',
  'SAVINGS_NOT_READY',
  'SAVINGS_UNAVAILABLE',
  'PROFILE_VERIFICATION_REQUIRED',
  'UNAUTHORIZED',
  'CSRF_FAILED',
  // The server refuses a cancel from an app that never showed the interest
  // forfeit: "Please update the app to cancel this goal."
  'APP_UPDATE_REQUIRED',
  ...['CANCEL', 'COMPLETE'].flatMap((K) =>
    [
      'REJECTED',
      'NOT_ELIGIBLE',
      'CONFLICT',
      'EXPIRED',
      'BUSY',
      'UNAVAILABLE',
      'NOT_FOUND',
      // The PIN step's "no longer valid, please start again" answer.
      'OPERATION_INVALID',
    ].map((suffix) => `${K}_${suffix}`)
  ),
]);

export const messageOf = (error: unknown) => {
  const code = codeOf(error);
  return code &&
    SAFE_SERVER_CODES.has(code) &&
    error instanceof Error &&
    error.message
    ? error.message
    : GOAL_LIFECYCLE_COPY.generic;
};

/** Refused before anything moved: the customer cannot fix it by starting again. */
export const NOT_STARTABLE_CODES: readonly string[] = [
  'GOAL_NOT_FOUND',
  // The goal's PiggyVest setup never finished: nothing to cancel yet.
  'GOAL_NOT_SET_UP',
  'SAVINGS_NOT_READY',
  'PROFILE_VERIFICATION_REQUIRED',
  'SAVINGS_UNAVAILABLE',
  'UNAUTHORIZED',
  // Only an app update fixes it, never starting again.
  'APP_UPDATE_REQUIRED',
];

export type GoalLifecycleStep =
  | 'review'
  | 'issuing'
  | 'pin'
  | 'submitting'
  | 'polling'
  | 'timed_out'
  | 'pin_cancelled'
  | 'done'
  | 'failed'
  | 'needs_review';

export type Outcome = {
  step: GoalLifecycleStep;
  message: string | null;
  canStartAgain: boolean;
  needsSignIn: boolean;
};

export const REVIEW: Outcome = {
  step: 'review',
  message: null,
  canStartAgain: false,
  needsSignIn: false,
};

/** A definite submit refusal, or null when money may have moved (read status). */
export function submitFailure(
  kind: GoalActionKind,
  error: unknown
): Outcome | null {
  const K = kind.toUpperCase();
  const code = codeOf(error);
  if (code === 'GOAL_NEEDS_REVIEW')
    return {
      step: 'needs_review',
      message: messageOf(error),
      canStartAgain: false,
      needsSignIn: false,
    };
  const again = [`${K}_EXPIRED`, `${K}_OPERATION_INVALID`, `${K}_BUSY`];
  const final = [
    `${K}_REJECTED`,
    `${K}_NOT_ELIGIBLE`,
    `${K}_CONFLICT`,
    'NOTHING_TO_REFUND',
    'NOTHING_TO_MOVE',
    'AMOUNT_TOO_LARGE',
    'WALLET_UNAVAILABLE',
    ...NOT_STARTABLE_CODES,
  ];
  if (code && (again.includes(code) || final.includes(code)))
    return {
      step: 'failed',
      message: messageOf(error),
      canStartAgain: again.includes(code),
      needsSignIn: code === 'UNAUTHORIZED',
    };
  // Anything else (a 503 unavailable, a timeout, an unreadable reply) may
  // have moved money: the caller must read status, never resubmit.
  return null;
}
