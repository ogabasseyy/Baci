import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import {
  codeOf,
  messageOf,
  NOT_STARTABLE_CODES,
  type Outcome,
} from './goal-lifecycle-outcomes';

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
