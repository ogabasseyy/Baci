import 'server-only';
import { piggyvestGoalCancelSchemas as schemas } from '@/schemas/piggyvest-goal-cancel';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import {
  type DeferForfeit,
  finishGoalCancel as finish,
} from './goal-cancel-finish';
import { HOLD_PAGES } from './goal-cancel-hold-pages';
import { runGoalCancelReconciliation } from './goal-cancel-reconciliation';
import { isConsistentGoalCancelSplit } from './goal-cancel-split-consistency';
import { publicStatus, readGoalCancelStatus } from './goal-cancel-status';
import { createGoalCancelStore } from './goal-cancel-store';
import { submitGoalCancel } from './goal-cancel-transfer';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import { transferToWallet } from './transfers';
import { retrievePiggyvestWallet } from './wallets';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

const LEGACY_FUNDS_REASON = 'legacy_funds_on_primary_goal';

// Goal cancel is deliberately independent of the PiggyVest feature flags and
// the master kill switch: the caller passes the recovery-style runtime, which
// ignores both, so a customer is never trapped in a goal. Nothing in this
// module reads a flag or the switch.

function bind(input: {
  configuration: unknown;
  scope: unknown;
  providerToken?: unknown;
}) {
  const configuration = piggyvestPrimarySavingsRuntimeSchema.parse(
    input.configuration
  );
  const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope);
  if (
    scope.integrationId !== configuration.integrationId ||
    scope.environment !== configuration.environment
  )
    throw new Error('Goal cancel binding unavailable');
  const store = createGoalCancelStore({
    scope,
    execute: createPrimaryWalletSavingsExecutor(configuration),
  });
  const token =
    input.providerToken === undefined
      ? null
      : piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
          input.providerToken
        );
  return { configuration, scope, store, token };
}

function bindEvidence(
  evidenceConfiguration: unknown,
  configuration: { integrationId: string; environment: string }
) {
  if (evidenceConfiguration === undefined) return null;
  const evidence = piggyvestPrimaryInflowRuntimeSchema.parse(
    evidenceConfiguration
  );
  if (
    evidence.integrationId !== configuration.integrationId ||
    evidence.environment !== configuration.environment
  )
    throw new Error('Goal cancel evidence binding unavailable');
  return evidence;
}

/** Step 1: the server issues the per-attempt operation id the PIN is bound to. */

export async function issuePrimaryWalletGoalCancel(input: {
  configuration: unknown;
  scope: unknown;
  goalId: unknown;
}) {
  const { store } = bind(input);
  const issued = await store.issue(schemas.goalId.parse(input.goalId));
  if (issued.status === 'needs_review')
    emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
      reason: LEGACY_FUNDS_REASON,
    });
  return issued;
}

/**
 * True only for a live issued operation id for this customer and goal. The
 * PIN verify route asks before minting a proof; the database still decides at
 * reservation time.
 */
export async function isPrimaryWalletGoalCancelIssued(input: {
  configuration: unknown;
  scope: unknown;
  goalId: unknown;
  operationId: unknown;
}) {
  const { store } = bind(input);
  return await store.isLiveIssued(
    schemas.goalId.parse(input.goalId),
    schemas.operationId.parse(input.operationId)
  );
}

/**
 * Step 2: spend the PIN proof, reserve, and move the saved principal once.
 * An early cancel refunds the principal only; the goal's interest is
 * forfeited to Ogabassey's interest wallet by its own leg, sent only after
 * the principal is confirmed (owner decision 2026-11-12).
 */
export async function submitPrimaryWalletGoalCancel(input: {
  configuration: unknown;
  reconciliationConfiguration?: unknown;
  scope: unknown;
  providerToken: unknown;
  goalId: unknown;
  operationId: unknown;
  pinProof: unknown;
  // True only while PiggyVest savings are switched on: the cancel itself
  // ignores the flags (nobody is trapped in a goal), Ogabassey's interest
  // leg does not, so a rollback stops new interest transfers.
  allowForfeitTransfers?: boolean;
  // Runs the interest leg after the answer is sent (the route passes
  // Next.js after()), so its provider calls never hold up or time out the
  // customer's confirmed answer. Without it the leg runs inline.
  deferForfeit?: DeferForfeit;
}) {
  const { configuration, scope, store, token } = bind(input);
  if (token === null) throw new Error('Goal cancel provider unavailable');
  const request = {
    goalId: schemas.goalId.parse(input.goalId),
    operationId: schemas.operationId.parse(input.operationId),
  };
  const pinProof = schemas.pinProof.parse(input.pinProof);
  const evidence = bindEvidence(
    input.reconciliationConfiguration,
    configuration
  );
  const provider = {
    token,
    baseUrl: getPrimaryWalletProviderOrigin(configuration.environment),
  };
  const result = await submitGoalCancel(request, {
    reserve: async (selection) => {
      const claim = await store.reserve(selection, pinProof);
      if (claim.status === 'needs_review')
        emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
          reason: LEGACY_FUNDS_REASON,
          operationId: request.operationId,
        });
      if (claim.status === 'claimed') {
        const reservation = schemas.reservation.parse(claim.reservation);
        if (reservation.businessId !== scope.businessId)
          throw new Error('Goal cancel ownership unavailable');
      }
      return claim;
    },
    retrieveWallet: async (walletId) =>
      await retrievePiggyvestWallet(provider, walletId),
    claimDispatch: (operationId, amountKobo) =>
      store.claimDispatch(operationId, amountKobo),
    splitDispatch: async (operationId, balanceKobo) => {
      const split = await store.splitDispatch(operationId, balanceKobo);
      // The database never answers an inconsistent split; if it ever did,
      // nothing is sent: the attempt is released (it must not sit dispatched
      // with no transfer) and a person is paged.
      if (
        split.status === 'dispatched' &&
        !isConsistentGoalCancelSplit(split, balanceKobo)
      ) {
        emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW', {
          reason: 'split_inconsistent',
          operationId,
        });
        await store.releaseAfterRejection(operationId).catch(() => false);
        return { status: 'needs_review' as const };
      }
      // A hold (released, a person must act): paged now, then acknowledged;
      // if this page is lost the daily sweep pages the hold instead.
      const hold = HOLD_PAGES[split.status];
      if (hold) {
        emitPiggyvestWebhookAlert(hold.code, {
          reason: hold.reason,
          operationId,
        });
        await store.ackHoldAlert(operationId).catch(() => undefined);
      }
      return split;
    },
    cancelBeforeDispatch: (operationId) =>
      store.cancelBeforeDispatch(operationId),
    releaseAfterRejection: (operationId) =>
      store.releaseAfterRejection(operationId),
    lookupTransfer: async (reservation) =>
      await lookupSavingsTransferReference({
        reference: reservation.reference,
        walletId: reservation.sourceWalletId,
        amountKobo: reservation.amountKobo,
        destinationWalletId: reservation.destinationWalletId,
        token: provider.token,
        baseUrl: provider.baseUrl,
      }),
    transfer: async ({ reservation, amountKobo }) =>
      await transferToWallet(provider, {
        amountKobo,
        sourceWalletId: reservation.sourceWalletId,
        destinationWalletId: reservation.destinationWalletId,
        reference: reservation.reference,
        narration: 'Savings goal cancelled',
      }),
  });
  let settled: Awaited<ReturnType<typeof submitGoalCancel>> = result;
  if (result.status === 'pending' && evidence) {
    try {
      settled = publicStatus(
        await runGoalCancelReconciliation({
          configuration: evidence,
          providerToken: token,
          operationId: request.operationId,
        })
      );
    } catch {
      settled = result;
    }
  }
  return await finish(settled, {
    store,
    provider,
    evidence,
    operationId: request.operationId,
    allowForfeitTransfers: input.allowForfeitTransfers === true,
    deferForfeit: input.deferForfeit,
  });
}

/**
 * Status check for a cancel: the only thing a retry does. It reads our record
 * and asks PiggyVest (TSQ) about the deterministic reference; it never posts
 * the customer's transfer. Once the principal is confirmed it may start
 * Ogabassey's interest-forfeit transfer (after the answer, never the
 * customer's money).
 */
export async function checkPrimaryWalletGoalCancelStatus(input: {
  configuration: unknown;
  reconciliationConfiguration: unknown;
  scope: unknown;
  providerToken: unknown;
  operationId: unknown;
  allowForfeitTransfers?: boolean;
  deferForfeit?: DeferForfeit;
}) {
  const { configuration, store, token } = bind(input);
  if (token === null) throw new Error('Goal cancel provider unavailable');
  const operationId = schemas.operationId.parse(input.operationId);
  const evidence = bindEvidence(
    input.reconciliationConfiguration,
    configuration
  );
  if (!evidence) throw new Error('Goal cancel evidence unavailable');
  const provider = {
    token,
    baseUrl: getPrimaryWalletProviderOrigin(configuration.environment),
  };
  return await finish(
    await readGoalCancelStatus(store, evidence, token, operationId),
    {
      store,
      provider,
      evidence,
      operationId,
      allowForfeitTransfers: input.allowForfeitTransfers === true,
      deferForfeit: input.deferForfeit,
    }
  );
}
