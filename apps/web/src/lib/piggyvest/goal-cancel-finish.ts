import 'server-only';
import {
  sweepGoalCancelForfeit,
  withGoalCancelAmounts,
} from './goal-cancel-forfeit-runtime';
import type { createGoalCancelStore } from './goal-cancel-store';

export type DeferForfeit = (task: () => Promise<unknown>) => void;

/**
 * Once the customer's principal is confirmed the interest leg may go (best
 * effort, never changes the customer's answer); every answer that has a
 * dispatched attempt behind it carries the server's amounts.
 */
export async function finishGoalCancel<T extends { status: string }>(
  result: T,
  input: {
    store: ReturnType<typeof createGoalCancelStore>;
    provider: { token: string; baseUrl: string };
    evidence: unknown | null;
    operationId: string;
    allowForfeitTransfers: boolean;
    deferForfeit?: DeferForfeit;
  }
) {
  // With savings switched off the daily worker sweep still settles in-flight
  // forfeits; nothing new is sent from here. The leg runs after the answer
  // when the caller can defer it (the daily sweep is the backstop either way).
  if (result.status === 'confirmed' && input.allowForfeitTransfers) {
    const leg = () => sweepGoalCancelForfeit(input);
    if (input.deferForfeit) input.deferForfeit(leg);
    else await leg();
  }
  return await withGoalCancelAmounts(input.store, input.operationId, result);
}
