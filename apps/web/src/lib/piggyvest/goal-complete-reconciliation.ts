import 'server-only';
import { piggyvestGoalCompleteSchemas as schemas } from '@/schemas/piggyvest-goal-complete';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import {
  createGoalCancelEvidenceStore,
  goalBalanceReader,
} from './goal-cancel-reconciliation';
import { GOAL_COMPLETE_STATEMENTS } from './goal-complete-statements';
import { alertGoalPurchaseRequest } from './goal-purchase-request-alert';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';

type EvidenceInput = {
  configuration: unknown;
  providerToken: unknown;
  fetchImplementation?: typeof fetch;
};

/**
 * The evidence-login side of a goal complete. It is the goal cancel evidence
 * store pointed at the complete statements and the complete alert code: the
 * same proof (re-query the provider, then settle or release), the same
 * residual balance read bound to the wallet, business and provider customer,
 * and the same rule that a conflict pages and is never a plain wait.
 */
function bind(input: EvidenceInput) {
  const configuration = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.configuration
  );
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  const store = createGoalCancelEvidenceStore({
    integrationId: configuration.integrationId,
    environment: configuration.environment,
    execute: createPrimaryWalletEvidenceExecutor(configuration),
    statements: GOAL_COMPLETE_STATEMENTS,
    alertCode: 'PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW',
    readGoalBalanceKobo: goalBalanceReader(configuration.environment, token),
  });
  const queryProvider = createSavingsVerifyQueryProvider({
    environment: configuration.environment,
    token,
    fetchImplementation: input.fetchImplementation,
  });
  return { store, queryProvider };
}

/**
 * Re-queries the provider for the dispatched complete and settles it
 * (success) or releases it (provider-reported failure). Anything else,
 * including a 404 right after the submit, stays pending: nothing is resent or
 * released.
 */
export async function runGoalCompleteReconciliation(
  input: EvidenceInput & { operationId: unknown }
) {
  const { store, queryProvider } = bind(input);
  const outcome = await reconcilePrimaryWalletSavings(input.operationId, {
    ...store,
    queryProvider,
  });
  return { ...outcome, needsReview: store.hasConflict() };
}

/**
 * Webhook-driven reconciliation: resolve each reference to a dispatched (or
 * dispatched-then-released) complete and run the same proof, so a complete
 * whose customer closed the app still settles. Returns 'unmatched' when no
 * reference names a goal complete.
 */
export async function runGoalCompleteOutflowReconciliation(
  input: EvidenceInput & { references: readonly string[] }
): Promise<'confirmed' | 'cancelled' | 'pending' | 'unmatched'> {
  const { store, queryProvider } = bind(input);
  for (const reference of input.references) {
    if (!schemas.reference.safeParse(reference).success) continue;
    const match = await store.findByReference(reference);
    if (!match) continue;
    const outcome = await reconcilePrimaryWalletSavings(match.operationId, {
      ...store,
      queryProvider,
    });
    // Nobody is polling a webhook settlement, so the owner is alerted here,
    // strictly after the settlement that saved the purchase request. The
    // alert never throws; an unsent one is retried by the next status check.
    if (outcome.status === 'confirmed')
      await alertGoalPurchaseRequest({
        configuration: input.configuration,
        operationId: match.operationId,
      }).catch(() => undefined);
    return outcome.status;
  }
  return 'unmatched';
}
