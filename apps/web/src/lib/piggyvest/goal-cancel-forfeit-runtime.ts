import 'server-only';
import {
  driveGoalCancelForfeit,
  type GoalCancelForfeitOutcome,
} from './goal-cancel-forfeit';
import { runGoalCancelForfeitReconciliation } from './goal-cancel-forfeit-reconciliation';
import type { createGoalCancelStore } from './goal-cancel-store';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import { transferToWallet } from './transfers';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

type Store = ReturnType<typeof createGoalCancelStore>;

/**
 * Sends the interest of an early-cancelled goal to Ogabassey's interest
 * wallet once the customer's principal is confirmed (owner decision
 * 2026-11-12). Best effort and never throws: the customer's answer never
 * depends on this leg, and an unsent forfeit is retried by the next status
 * check (the daily reconciliation also flags a goal wallet that still holds
 * the interest). Pages a person when the leg cannot finish by itself.
 */
export async function sweepGoalCancelForfeit(input: {
  store: Store;
  provider: { token: string; baseUrl: string };
  evidence: unknown | null;
  operationId: string;
}): Promise<GoalCancelForfeitOutcome | 'failed'> {
  const { store, provider, evidence, operationId } = input;
  try {
    const outcome = await driveGoalCancelForfeit(operationId, {
      claim: async (id) => {
        const claim = await store.claimForfeit(id);
        // The database stamps the first report of a stuck forfeit, so a
        // person is paged once, not on every customer status poll.
        if (
          (claim.status === 'needs_review' || claim.status === 'unavailable') &&
          claim.alert === true
        )
          emitPiggyvestWebhookAlert(
            claim.status === 'needs_review'
              ? 'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW'
              : 'PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE',
            {
              reason:
                claim.status === 'needs_review'
                  ? 'forfeit_needs_review'
                  : 'interest_wallet_disabled',
              operationId,
            }
          );
        return claim;
      },
      transfer: async (forfeit) =>
        await transferToWallet(provider, {
          amountKobo: forfeit.amountKobo,
          sourceWalletId: forfeit.sourceWalletId,
          destinationWalletId: forfeit.destinationWalletId,
          reference: forfeit.reference,
          narration: 'Savings goal cancelled early: interest forfeited',
        }),
      lookupTransfer: async (forfeit) =>
        await lookupSavingsTransferReference({
          reference: forfeit.reference,
          walletId: forfeit.sourceWalletId,
          amountKobo: forfeit.amountKobo,
          destinationWalletId: forfeit.destinationWalletId,
          token: provider.token,
          baseUrl: provider.baseUrl,
        }),
      release: (id) => store.releaseForfeit(id),
      ...(evidence === null
        ? {}
        : {
            reconcile: async (forfeitId: string) =>
              await runGoalCancelForfeitReconciliation({
                configuration: evidence,
                providerToken: provider.token,
                operationId: forfeitId,
              }),
          }),
    });
    return outcome;
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
  if (!['confirmed', 'pending', 'needs_review'].includes(result.status))
    return result;
  const amounts = await store.readAmounts(operationId).catch(() => null);
  return amounts ? { ...result, amounts } : result;
}
