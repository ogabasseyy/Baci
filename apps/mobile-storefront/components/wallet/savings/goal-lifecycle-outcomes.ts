/**
 * Every sentence the goal cancel / complete flow shows that is not a server
 * message. All of it awaits the owner's written approval.
 */
export const GOAL_LIFECYCLE_COPY = {
  cancel: {
    screenTitle: 'Cancel goal',
    entryButton: 'Cancel goal',
    entryLabel: 'Cancel savings goal',
    reviewTitle: 'Cancel this goal?',
    // Owner decision 2026-11-12: cancelling early returns the saved money
    // only; the interest the goal earned is forfeited.
    reviewBody:
      'The money you saved goes back to your main wallet. Because you are cancelling early, the interest this goal earned is not refunded. This goal will be closed.',
    primary: 'Continue',
    secondary: 'Keep goal',
    successTitle: 'Goal cancelled',
    successBody:
      'The money you saved is back in your main wallet. The interest this goal earned was not refunded.',
    rejected:
      'This cancellation was not completed. Your savings are still in your goal.',
  },
  complete: {
    screenTitle: 'Complete goal',
    entryButton: 'Complete goal',
    entryLabel: 'Complete savings goal',
    reviewTitle: 'Complete this goal',
    reviewBody:
      'Your whole goal balance, including interest already paid into it, moves to your main wallet and we send your purchase request to the store team. They will contact you to finish your purchase. Nothing is spent or paid out automatically.',
    primary: 'Continue',
    secondary: 'Not now',
    successTitle: 'Goal completed',
    successBody:
      'Your money is in your main wallet and your purchase request has been sent.',
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
  'NOTHING_TO_REFUND',
  'NOTHING_TO_MOVE',
  'AMOUNT_TOO_LARGE',
  'WALLET_UNAVAILABLE',
  'SAVINGS_NOT_READY',
  'SAVINGS_UNAVAILABLE',
  'PROFILE_VERIFICATION_REQUIRED',
  'UNAUTHORIZED',
  'CSRF_FAILED',
  ...['CANCEL', 'COMPLETE'].flatMap((K) =>
    [
      'REJECTED',
      'NOT_ELIGIBLE',
      'CONFLICT',
      'EXPIRED',
      'BUSY',
      'UNAVAILABLE',
      'NOT_FOUND',
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
  'SAVINGS_NOT_READY',
  'PROFILE_VERIFICATION_REQUIRED',
  'SAVINGS_UNAVAILABLE',
  'UNAUTHORIZED',
];
