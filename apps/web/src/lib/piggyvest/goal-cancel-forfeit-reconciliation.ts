import 'server-only';
import { piggyvestGoalCancelForfeitSchemas as schemas } from '@/schemas/piggyvest-goal-cancel-forfeit';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { GOAL_CANCEL_FORFEIT_STATEMENTS } from './goal-cancel-forfeit-statements';
import {
  createGoalCancelEvidenceStore,
  goalBalanceReader,
} from './goal-cancel-reconciliation';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';

type EvidenceInput = {
  configuration: unknown;
  providerToken: unknown;
  fetchImplementation?: typeof fetch;
};

/**
 * The evidence-login side of the interest forfeit leg of an early cancel. It
 * is the goal cancel evidence store pointed at the forfeit statements: the
 * same proof (re-query PiggyVest, then settle or release), the same goal
 * wallet balance read (any money left after the forfeit is a review), and a
 * conflict pages under its own alert code. The customer is never involved:
 * their principal was confirmed before this leg could be sent.
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
    statements: GOAL_CANCEL_FORFEIT_STATEMENTS,
    alertCode: 'PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW',
    readGoalBalanceKobo: goalBalanceReader(configuration.environment, token),
  });
  const queryProvider = createSavingsVerifyQueryProvider({
    environment: configuration.environment,
    token,
    fetchImplementation: input.fetchImplementation,
  });
  return { store, queryProvider };
}

/** Status read of one dispatched forfeit (by forfeit id). Never resends. */
export async function runGoalCancelForfeitReconciliation(
  input: EvidenceInput & { operationId: unknown }
) {
  const { store, queryProvider } = bind(input);
  const outcome = await reconcilePrimaryWalletSavings(input.operationId, {
    ...store,
    queryProvider,
  });
  return { ...outcome, needsReview: store.hasConflict() };
}

/** Webhook path: settle a forfeit named by an outflow reference. */
export async function runGoalCancelForfeitOutflowReconciliation(
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
    return outcome.status;
  }
  return 'unmatched';
}
