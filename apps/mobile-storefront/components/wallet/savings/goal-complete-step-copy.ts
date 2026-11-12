import { GOAL_LIFECYCLE_COPY } from './goal-lifecycle-outcomes';

/** Words for completing a goal inside the savings sheet (owner-approved mock). */
export const GOAL_COMPLETE_STEP_COPY = {
  title: 'You did it!',
  subtitle: (goalTitle: string) => `Your ${goalTitle} is fully saved.`,
  saved: 'Saved',
  interest: 'Interest earned',
  toWallet: 'Moves to your wallet',
  nextTitle: 'What happens next',
  next: [
    'Your money moves to your wallet',
    'Our team contacts you to finish your order',
    'You get your new phone',
  ],
  pinNote: 'You’ll confirm with your wallet PIN.',
  confirm: 'Complete and request my phone',
  notNow: 'Not now',
  working: 'Completing your goal…',
  pending: GOAL_LIFECYCLE_COPY.pending,
  doneTitle: 'Request sent',
  doneBody: (amount: string, goalTitle: string) =>
    `${amount} is in your wallet. Our team will contact you soon to finish your ${goalTitle} order.`,
  done: 'Done',
  close: 'Close',
  checkAgain: GOAL_LIFECYCLE_COPY.checkAgain,
  tryAgain: GOAL_LIFECYCLE_COPY.tryAgain,
  signIn: GOAL_LIFECYCLE_COPY.signIn,
  pinCancelled: GOAL_LIFECYCLE_COPY.pinCancelled,
} as const;
