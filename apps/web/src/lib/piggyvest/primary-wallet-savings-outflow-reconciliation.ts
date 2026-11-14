import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas as schemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { runGoalCancelForfeitOutflowReconciliation } from './goal-cancel-forfeit-reconciliation';
import { runGoalCancelOutflowReconciliation } from './goal-cancel-reconciliation';
import { runGoalCompleteOutflowReconciliation } from './goal-complete-reconciliation';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';
import { createPrimaryWalletSavingsReconciliationStore } from './primary-wallet-savings-reconciliation-store';

const GOAL_TRANSFER_KINDS = [
  {
    name: 'cancel',
    prefix: 'pvb-cancel-',
    reconcile: runGoalCancelOutflowReconciliation,
  },
  {
    name: 'complete',
    prefix: 'pvb-complete-',
    reconcile: runGoalCompleteOutflowReconciliation,
  },
  {
    // The interest leg of an early cancel (Ogabassey's interest wallet).
    name: 'cancel interest forfeit',
    prefix: 'pvb-forfeit-',
    reconcile: runGoalCancelForfeitOutflowReconciliation,
  },
] as const;

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
  // Not a savings transfer: it may be a goal cancel refund or a goal complete
  // transfer (same evidence login, same proof), which would otherwise stay
  // dispatched until the customer polls.
  // Goal cancel and complete are auxiliary to the savings path: a failure in
  // one lookup (for example a function not yet deployed) must not 503 legacy
  // outflow webhooks, must not hide the other kind, and the transfer still
  // reconciles from the client status path. A failed lookup of OUR reference
  // stays retryable instead: calling it unmatched would mark the webhook
  // processed and strand a settled transfer until the customer polls.
  let retryable = false;
  for (const kind of GOAL_TRANSFER_KINDS) {
    try {
      const outcome = await kind.reconcile({
        configuration: input.configuration,
        providerToken: input.providerToken,
        references: input.references,
        fetchImplementation: input.fetchImplementation,
      });
      if (outcome !== 'unmatched') return outcome;
    } catch (error) {
      console.warn(
        '[PiggyVest Webhook] Goal %s reconciliation skipped:',
        kind.name,
        error instanceof Error ? error.message : error
      );
      if (
        input.references.some((reference) => reference.startsWith(kind.prefix))
      )
        retryable = true;
    }
  }
  return retryable ? 'pending' : 'unmatched';
}
