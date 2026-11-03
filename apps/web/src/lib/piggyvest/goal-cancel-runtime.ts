import 'server-only';
import { piggyvestGoalCancelSchemas as schemas } from '@/schemas/piggyvest-goal-cancel';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { runGoalCancelReconciliation } from './goal-cancel-reconciliation';
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

/** Step 2: spend the PIN proof, reserve, and move the full balance once. */
export async function submitPrimaryWalletGoalCancel(input: {
  configuration: unknown;
  reconciliationConfiguration?: unknown;
  scope: unknown;
  providerToken: unknown;
  goalId: unknown;
  operationId: unknown;
  pinProof: unknown;
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
  if (result.status !== 'pending' || !evidence) return result;
  try {
    return publicStatus(
      await runGoalCancelReconciliation({
        configuration: evidence,
        providerToken: token,
        operationId: request.operationId,
      })
    );
  } catch {
    return result;
  }
}

// A settlement conflict is never shown as released or as a plain wait: the
// provider moved the money, so the customer is told it is under review and an
// operator has already been paged (see the evidence store).
function publicStatus(outcome: {
  status: 'confirmed' | 'cancelled' | 'pending';
  needsReview?: boolean;
}) {
  if (outcome.needsReview === true && outcome.status === 'pending')
    return { status: 'needs_review' } as const;
  return outcome.status === 'cancelled'
    ? ({ status: 'released' } as const)
    : ({ status: outcome.status } as const);
}

/**
 * Status check for a cancel: the only thing a retry does. It reads our record
 * and asks PiggyVest (TSQ) about the deterministic reference; it never posts.
 */
export async function checkPrimaryWalletGoalCancelStatus(input: {
  configuration: unknown;
  reconciliationConfiguration: unknown;
  scope: unknown;
  providerToken: unknown;
  operationId: unknown;
}) {
  const { configuration, store, token } = bind(input);
  if (token === null) throw new Error('Goal cancel provider unavailable');
  const operationId = schemas.operationId.parse(input.operationId);
  const evidence = bindEvidence(
    input.reconciliationConfiguration,
    configuration
  );
  if (!evidence) throw new Error('Goal cancel evidence unavailable');
  let state = await store.readStatus(operationId);
  if (state === 'reserved') {
    // Nothing was sent for a reserved attempt; only a stale one is released
    // (a live submission holds it for seconds between reserve and dispatch).
    await store.cancelStaleReservation(operationId).catch(() => undefined);
    state = await store.readStatus(operationId);
  }
  if (state === null) return { status: 'not_found' as const };
  if (state === 'confirmed') return { status: 'confirmed' as const };
  if (state === 'released') {
    // A released attempt that WAS dispatched can still turn out to have
    // succeeded at the provider (indexed late). Re-check it: a verified
    // success settles it, anything else leaves it released.
    try {
      const outcome = await runGoalCancelReconciliation({
        configuration: evidence,
        providerToken: token,
        operationId,
      });
      if (outcome.status === 'confirmed')
        return { status: 'confirmed' as const };
      if (outcome.needsReview === true)
        return { status: 'needs_review' as const };
    } catch {
      // The status answer below is still the recorded state.
    }
    return { status: 'released' as const };
  }
  if (state === 'issued') return { status: 'not_started' as const };
  if (state === 'reserved') return { status: 'pending' as const };
  return publicStatus(
    await runGoalCancelReconciliation({
      configuration: evidence,
      providerToken: token,
      operationId,
    })
  );
}
