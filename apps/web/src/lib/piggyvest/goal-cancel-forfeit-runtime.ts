import 'server-only';
import {
  driveGoalCancelForfeit,
  type GoalCancelForfeitOutcome,
} from './goal-cancel-forfeit';
import { forfeitDriverPorts } from './goal-cancel-forfeit-ports';
import type { createGoalCancelStore } from './goal-cancel-store';
import {
  readGoalInterestWalletId,
  readGoalInterestWalletOwnerId,
} from './goal-interest-wallet-env';

type Store = ReturnType<typeof createGoalCancelStore>;

/**
 * Sends the interest of an early-cancelled goal to Ogabassey's interest
 * wallet once the customer's principal is confirmed (owner decision
 * 2026-11-12). Best effort and never throws: the customer's answer never
 * depends on this leg. A forfeit this misses is sent by the next status check
 * or by the hourly worker sweep (goal-cancel-forfeit-sweep). Pages a person
 * when the leg cannot finish by itself.
 */
export async function sweepGoalCancelForfeit(input: {
  store: Store;
  provider: { token: string; baseUrl: string };
  evidence: unknown | null;
  operationId: string;
}): Promise<GoalCancelForfeitOutcome | 'failed'> {
  const { store, provider, evidence, operationId } = input;
  try {
    return await driveGoalCancelForfeit(
      operationId,
      forfeitDriverPorts({
        claim: (id) => store.claimForfeit(id),
        release: (id) => store.releaseForfeit(id),
        unclaim: (id) => store.unclaimForfeit(id),
        markPosting: (id) => store.markForfeitPosting(id),
        provider,
        evidence,
        operationId,
        expectedDestinationWalletId: readGoalInterestWalletId(),
        expectedDestinationOwnerId: readGoalInterestWalletOwnerId(),
      })
    );
  } catch {
    return 'failed';
  }
}

/**
 * What the customer gets back and what is NOT refunded to them, from the
 * server, for a dispatched (or later) attempt. forfeitedInterestKobo is the
 * customer-facing "interest (not refunded)" figure, fixed at dispatch: it is
 * true for the customer as soon as the principal is confirmed, whether or not
 * Ogabassey's interest-wallet transfer (an internal leg, tracked and paged
 * separately) has settled yet. Absent before dispatch, for attempts made
 * before the split existed, or when the read fails: the app then shows the
 * status alone.
 */
export async function withGoalCancelAmounts<T extends { status: string }>(
  store: Store,
  operationId: string,
  result: T
): Promise<
  T & { amounts?: { principalKobo: number; forfeitedInterestKobo: number } }
> {
  // Not while the principal is under review: the provider moved money the
  // database refused to settle, so "back to your wallet" is not yet true.
  if (!['confirmed', 'pending'].includes(result.status)) return result;
  const amounts = await store.readAmounts(operationId).catch(() => null);
  return amounts ? { ...result, amounts } : result;
}
