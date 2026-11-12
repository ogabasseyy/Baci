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
 * Pages a person once per stuck forfeit: the database stamps the first
 * report (claim "alert") and the third-rejection cap (release needs_review).
 */
export function forfeitDriverPorts(input: {
  claim: Ports['claim'];
  release: Ports['release'];
  unclaim: Ports['unclaim'];
  provider: { token: string; baseUrl: string };
  evidence: unknown | null;
  operationId: string;
  // PIGGYVEST_INTEREST_WALLET_ID: the deployment's own record of
  // Ogabassey's interest wallet; it must match the database's.
  expectedDestinationWalletId: string | null;
}): Ports {
  const { provider, evidence, operationId } = input;
  return {
    claim: async (id) => {
      const claim = await input.claim(id);
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
        wallet.api_customer_id !== forfeit.providerCustomerId &&
        wallet.currency === 'NGN' &&
        wallet.status === 'active';
      if (!ours)
        emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE', {
          reason: 'interest_wallet_not_ours',
          operationId,
        });
      return ours;
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
    unclaim: input.unclaim,
    release: async (id) => {
      const released = await input.release(id);
      if (released === 'needs_review')
        emitPiggyvestWebhookAlert(
          'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
          {
            reason: 'forfeit_rejected_three_times',
            operationId,
          }
        );
      return released;
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
