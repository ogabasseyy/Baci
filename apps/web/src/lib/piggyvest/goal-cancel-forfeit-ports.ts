import 'server-only';
import type { driveGoalCancelForfeit } from './goal-cancel-forfeit';
import { runGoalCancelForfeitReconciliation } from './goal-cancel-forfeit-reconciliation';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import { transferToWallet } from './transfers';
import { retrievePiggyvestWallet } from './wallets';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

type Ports = Parameters<typeof driveGoalCancelForfeit>[1];

/**
 * The provider, settlement and paging half of the forfeit driver, shared by
 * the customer status path (customer scope) and the scheduled worker sweep
 * (integration authority), which differ only in how they claim and release.
 * Pages a person once per stuck forfeit: the database answers "alert" until
 * the page is acknowledged (ackAlert, called only after the page is emitted,
 * so a crash or lost answer repeats the page rather than losing it). Reviews
 * entered by a release are also paged by the daily sweep until acknowledged.
 */
export function forfeitDriverPorts(input: {
  claim: Ports['claim'];
  // As Ports['release'], but released_needs_review names the reviewed row.
  release: (
    forfeitId: string
  ) => Promise<
    | Exclude<Awaited<ReturnType<Ports['release']>>, 'released_needs_review'>
    | `released_needs_review:${string}`
  >;
  unclaim: Ports['unclaim'];
  markPosting: Ports['markPosting'];
  // Records an emitted page for a forfeit; a failure only means it pages again.
  ackAlert: (forfeitId: string) => Promise<unknown>;
  provider: { token: string; baseUrl: string };
  evidence: unknown | null;
  operationId: string;
  // PIGGYVEST_INTEREST_WALLET_ID: the deployment's own record of
  // Ogabassey's interest wallet; it must match the database's.
  expectedDestinationWalletId: string | null;
  // PIGGYVEST_INTEREST_WALLET_OWNER_ID: the PiggyVest customer that owns
  // Ogabassey's interest wallet; the wallet must belong to exactly it.
  expectedDestinationOwnerId: string | null;
}): Ports {
  const { provider, evidence, operationId } = input;
  // Never fails the caller: an unacknowledged page is simply sent again.
  const acknowledge = async (forfeitId: string) => {
    try {
      await input.ackAlert(forfeitId);
    } catch {
      // Not acknowledged: the page is simply sent again later.
    }
  };
  return {
    claim: async (id) => {
      const claim = await input.claim(id);
      if (
        (claim.status === 'needs_review' || claim.status === 'unavailable') &&
        claim.alert === true
      ) {
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
        await acknowledge(claim.forfeitId);
      }
      return claim;
    },
    verifyDestination: async (forfeit) => {
      const wallet = (await retrievePiggyvestWallet(
        provider,
        forfeit.destinationWalletId
      )) as Partial<
        Record<
          'id' | 'business_id' | 'api_customer_id' | 'currency' | 'status',
          unknown
        >
      >;
      // Ogabassey's own active NGN wallet in this business: the database's
      // configured wallet must equal the deployment's
      // PIGGYVEST_INTEREST_WALLET_ID (two independent settings, so one typo
      // can not redirect interest), and PiggyVest must confirm it is an
      // active NGN wallet in this business and not the customer's.
      const ours =
        input.expectedDestinationWalletId !== null &&
        forfeit.destinationWalletId === input.expectedDestinationWalletId &&
        wallet.id === forfeit.destinationWalletId &&
        wallet.business_id === forfeit.businessId &&
        input.expectedDestinationOwnerId !== null &&
        wallet.api_customer_id === input.expectedDestinationOwnerId &&
        wallet.api_customer_id !== forfeit.providerCustomerId &&
        wallet.currency === 'NGN' &&
        wallet.status === 'active';
      if (!ours) return false;
      // The source must still be this customer's active NGN goal wallet in
      // this business, holding at least the interest being sent: a reassigned
      // or poisoned wallet id can never be debited by the business token.
      const source = (await retrievePiggyvestWallet(
        provider,
        forfeit.sourceWalletId
      )) as Partial<
        Record<
          | 'id'
          | 'business_id'
          | 'api_customer_id'
          | 'currency'
          | 'status'
          | 'balance',
          unknown
        >
      >;
      // Not paged here: the hand-back that follows pages once per forfeit.
      return (
        source.id === forfeit.sourceWalletId &&
        source.business_id === forfeit.businessId &&
        source.api_customer_id === forfeit.providerCustomerId &&
        source.currency === 'NGN' &&
        source.status === 'active' &&
        typeof source.balance === 'number' &&
        Number.isSafeInteger(source.balance) &&
        source.balance >= forfeit.amountKobo
      );
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
    markPosting: input.markPosting,
    unclaim: async (id, reason) => {
      const unclaimed = await input.unclaim(id, reason);
      // Acknowledged after the page, so a lasting wallet mismatch (or check
      // outage) pages once, not on every attempt, and never silently.
      if (unclaimed === 'unclaimed_first') {
        emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE', {
          reason:
            reason === 'mismatch'
              ? 'interest_wallet_not_ours'
              : 'interest_wallet_check_failed',
          operationId,
        });
        await acknowledge(id);
      }
      return unclaimed;
    },
    release: async (id) => {
      const released = await input.release(id);
      // The reviewed row: this forfeit at the third rejection, or the plan the
      // replacement could not merge into. Paged, then acknowledged.
      if (released === 'released' || released === 'not_released')
        return released;
      const reviewed =
        released === 'needs_review'
          ? id
          : released.slice('released_needs_review:'.length);
      emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW', {
        reason:
          released === 'needs_review'
            ? 'forfeit_rejected_three_times'
            : 'forfeit_over_ceiling',
        operationId,
      });
      await acknowledge(reviewed);
      return released === 'needs_review' ? released : 'released_needs_review';
    },
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
  };
}
