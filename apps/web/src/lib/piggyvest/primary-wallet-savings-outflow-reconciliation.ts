import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { runGoalCancelOutflowReconciliation } from './goal-cancel-reconciliation';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';
import { createPrimaryWalletSavingsReconciliationStore } from './primary-wallet-savings-reconciliation-store';

// Webhook-driven savings reconciliation: outflow webhooks attribute by
// provider reference, so resolve each candidate to its dispatched operation
// and run the SAME proof (re-query the provider, then settle or release)
// the client status path runs. Without this, an accepted transfer whose
// client never polls status stays dispatched forever. References that fail
// validation are skipped, never thrown: reserved references were validated
// at reserve time, so a malformed candidate cannot match — throwing would
// trap the event in a retry loop it can never exit.
export async function runPrimaryWalletSavingsOutflowReconciliation(input: {
  configuration: unknown;
  providerToken: unknown;
  references: readonly string[];
  fetchImplementation?: typeof fetch;
}): Promise<'confirmed' | 'cancelled' | 'pending' | 'unmatched'> {
  const configuration = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.configuration
  );
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  const store = createPrimaryWalletSavingsReconciliationStore({
    integrationId: configuration.integrationId,
    environment: configuration.environment,
    execute: createPrimaryWalletEvidenceExecutor(configuration),
  });
  const ports = {
    ...store,
    queryProvider: createSavingsVerifyQueryProvider({
      environment: configuration.environment,
      token,
      fetchImplementation: input.fetchImplementation,
    }),
  };
  for (const reference of input.references) {
    if (!schemas.reserved.shape.reference.safeParse(reference).success)
      continue;
    const reservation = await store.findDispatchedByReference(reference);
    if (!reservation) continue;
    // Candidates are alternative paths to the same transfer, so the first
    // attribution wins; reconcile through the shared core.
    const outcome = await reconcilePrimaryWalletSavings(
      reservation.operationId,
      ports
    );
    return outcome.status;
  }
  // Not a savings transfer: it may be a goal cancel refund (same evidence
  // login, same proof), which would otherwise stay dispatched until the
  // customer polls.
  // Goal cancel is auxiliary to the savings path: a failure here (for
  // example the lookup not yet deployed) must not 503 legacy outflow
  // webhooks, and the cancel still reconciles from the client status path.
  try {
    return await runGoalCancelOutflowReconciliation({
      configuration: input.configuration,
      providerToken: input.providerToken,
      references: input.references,
      fetchImplementation: input.fetchImplementation,
    });
  } catch (error) {
    console.warn(
      '[PiggyVest Webhook] Goal cancel reconciliation skipped:',
      error instanceof Error ? error.message : error
    );
    return 'unmatched';
  }
}
