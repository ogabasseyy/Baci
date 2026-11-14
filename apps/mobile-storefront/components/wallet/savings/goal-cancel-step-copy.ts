import { GOAL_LIFECYCLE_COPY } from './goal-lifecycle-outcomes';

/** Words for cancelling a goal inside the savings sheet (owner-approved mock). */
export const GOAL_CANCEL_STEP_COPY = {
  title: (goalTitle: string) => `Cancel ${goalTitle}?`,
  emptyBody: 'You haven’t saved anything yet, so no money moves.',
  savedBody: 'Your savings go back to your main wallet.',
  // Said even with ₦0 interest so far: interest the server hasn't reported
  // yet is forfeited too, and the goal carries no interest flag to key on.
  interestNote: 'Any interest earned isn’t refunded.',
  saved: 'Saved',
  // The goal's balance as it stands; with the split unknown, never labelled
  // as an amount coming back (some of it may be interest).
  inThisGoal: 'In this goal',
  // "So far": interest not reported yet is forfeited too.
  interestForfeited: 'Interest so far (not refunded)',
  forfeitNote: 'Cancelling early means you lose the interest on this goal.',
  unknownSplitNote:
    'Your savings go back to your main wallet. Any interest on this goal is not refunded.',
  backToWallet: 'Back to your wallet',
  pinNote: 'You’ll confirm with your wallet PIN.',
  confirm: 'Cancel goal',
  keep: 'Keep saving',
  working: 'Cancelling your goal…',
  pending: GOAL_LIFECYCLE_COPY.pending,
  doneTitle: GOAL_LIFECYCLE_COPY.cancel.successTitle,
  doneBody: 'Your savings are back in your main wallet.',
  doneEmptyBody: 'Your goal is closed.',
  done: 'Done',
  close: 'Close',
  checkAgain: GOAL_LIFECYCLE_COPY.checkAgain,
  tryAgain: GOAL_LIFECYCLE_COPY.tryAgain,
  signIn: GOAL_LIFECYCLE_COPY.signIn,
  pinCancelled: GOAL_LIFECYCLE_COPY.pinCancelled,
} as const;
