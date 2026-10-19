import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
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
  return 'unmatched';
}
