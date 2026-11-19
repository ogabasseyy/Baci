import 'server-only';
import { piggyvestGoalCompleteSchemas as schemas } from '@/schemas/piggyvest-goal-complete';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { submitGoalCancel as submitGoalBalanceTransfer } from './goal-cancel-transfer';
import { runGoalCompleteReconciliation } from './goal-complete-reconciliation';
import { createGoalCompleteStore } from './goal-complete-store';
import { alertGoalPurchaseRequest } from './goal-purchase-request-alert';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import { transferToWallet } from './transfers';
import { retrievePiggyvestWallet } from './wallets';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

const LEGACY_FUNDS_REASON = 'legacy_funds_on_primary_goal';

// Goal complete moves the customer's own money to their own main wallet, like
// cancel, so it is independent of the PiggyVest feature flags and the master
// kill switch: the caller passes the recovery-style runtime, which ignores
// both. Nothing in this module reads a flag or the switch. Its only off
// switch is PIGGYVEST_GOAL_COMPLETE_DISABLED, applied by the routes.

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
    throw new Error('Goal complete binding unavailable');
  const store = createGoalCompleteStore({
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
    throw new Error('Goal complete evidence binding unavailable');
  return evidence;
}

// The purchase request was saved by the settlement, so this only alerts. It
// never throws: a failed alert leaves the request unalerted and the next
// status check tries again.
async function alertOwner(evidence: unknown, operationId: string) {
  if (evidence === null || evidence === undefined) return;
  try {
    await alertGoalPurchaseRequest({
      configuration: evidence,
      operationId,
    });
  } catch {
    // Best effort by design.
  }
}

/** Step 1: the server issues the per-attempt operation id the PIN is bound to. */
export async function issuePrimaryWalletGoalComplete(input: {
  configuration: unknown;
  scope: unknown;
  goalId: unknown;
}) {
  const { store } = bind(input);
  const issued = await store.issue(schemas.goalId.parse(input.goalId));
  if (issued.status === 'needs_review')
    emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW', {
      reason: LEGACY_FUNDS_REASON,
    });
  return issued;
}

/**
 * True only for a live issued operation id for this customer and goal. The
 * PIN verify route asks before minting a proof; the database still decides at
 * reservation time.
 */
export async function isPrimaryWalletGoalCompleteIssued(input: {
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

/** Step 2: spend the PIN proof, reserve, and move the full balance once. */
export async function submitPrimaryWalletGoalComplete(input: {
  configuration: unknown;
  reconciliationConfiguration?: unknown;
  scope: unknown;
  providerToken: unknown;
  goalId: unknown;
  operationId: unknown;
  pinProof: unknown;
}) {
  const { configuration, scope, store, token } = bind(input);
  if (token === null) throw new Error('Goal complete provider unavailable');
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
  const result = await submitGoalBalanceTransfer(request, {
    reserve: async (selection) => {
      const claim = await store.reserve(selection, pinProof);
      if (claim.status === 'needs_review')
        emitPiggyvestWebhookAlert('PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW', {
          reason: LEGACY_FUNDS_REASON,
          operationId: request.operationId,
        });
      if (claim.status === 'claimed') {
        const reservation = schemas.reservation.parse(claim.reservation);
        if (reservation.businessId !== scope.businessId)
          throw new Error('Goal complete ownership unavailable');
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
        narration: 'Savings goal completed',
      }),
  });
  if (result.status === 'confirmed') {
    // A replay of a settled complete: the request is already saved, so a
    // missed alert is retried here.
    await alertOwner(evidence, request.operationId);
    return result;
  }
  if (result.status !== 'pending' || !evidence) return result;
  try {
    const outcome = publicStatus(
      await runGoalCompleteReconciliation({
        configuration: evidence,
        providerToken: token,
        operationId: request.operationId,
      })
    );
    if (outcome.status === 'confirmed')
      await alertOwner(evidence, request.operationId);
    return outcome;
  } catch {
    return result;
  }
}

/**
 * Status check for a complete: the only thing a retry does. It reads our
 * record and asks PiggyVest (TSQ) about the deterministic reference; it never
 * posts. A settled complete whose owner alert is still unsent is alerted
 * again here.
 */
export async function checkPrimaryWalletGoalCompleteStatus(input: {
  configuration: unknown;
  reconciliationConfiguration: unknown;
  scope: unknown;
  providerToken: unknown;
  operationId: unknown;
}) {
  const { configuration, store, token } = bind(input);
  if (token === null) throw new Error('Goal complete provider unavailable');
  const operationId = schemas.operationId.parse(input.operationId);
  const evidence = bindEvidence(
    input.reconciliationConfiguration,
    configuration
  );
  if (!evidence) throw new Error('Goal complete evidence unavailable');
  let state = await store.readStatus(operationId);
  if (state === 'reserved') {
    // Nothing was sent for a reserved attempt; only a stale one is released.
    await store.cancelStaleReservation(operationId).catch(() => undefined);
    state = await store.readStatus(operationId);
  }
  if (state === null) return { status: 'not_found' as const };
  if (state === 'confirmed') {
    await alertOwner(evidence, operationId);
    return { status: 'confirmed' as const };
  }
  // Review is its own recorded state, whichever path settled it first. A
  // cleared review moved the balance but did NOT complete the goal (the goal
  // stayed open and no purchase request exists), so it is never confirmed.
  if (state === 'needs_review' || state === 'reviewed')
    return { status: 'needs_review' as const };
  if (state === 'released') {
    // A released attempt that WAS dispatched can still turn out to have
    // succeeded at the provider (indexed late). Re-check it: a verified
    // success settles it, anything else leaves it released.
    try {
      const outcome = await runGoalCompleteReconciliation({
        configuration: evidence,
        providerToken: token,
        operationId,
      });
      if (outcome.status === 'confirmed') {
        await alertOwner(evidence, operationId);
        return { status: 'confirmed' as const };
      }
      if (outcome.needsReview === true)
        return { status: 'needs_review' as const };
    } catch {
      // The status answer below is still the recorded state.
    }
    return { status: 'released' as const };
  }
  if (state === 'issued') return { status: 'not_started' as const };
  if (state === 'reserved') return { status: 'pending' as const };
  const outcome = publicStatus(
    await runGoalCompleteReconciliation({
      configuration: evidence,
      providerToken: token,
      operationId,
    })
  );
  if (outcome.status === 'confirmed') await alertOwner(evidence, operationId);
  return outcome;
}
