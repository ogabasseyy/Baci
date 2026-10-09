import 'server-only';
import { runPrimaryWalletSavingsOutflowReconciliation } from './primary-wallet-savings-outflow-reconciliation';
import { readPrimaryWalletSavingsRuntime } from './primary-wallet-savings-runtime';

export interface SavingsOutflowProcessorDeps {
  savingsRuntime?: {
    reconciliationConfiguration: unknown;
    providerToken: unknown;
  } | null;
  fetchImplementation?: typeof fetch;
}

function readSavingsRuntimeForOutflow(): SavingsOutflowProcessorDeps['savingsRuntime'] {
  try {
    return readPrimaryWalletSavingsRuntime();
  } catch (error) {
    // Savings is auxiliary to the legacy outflow path: a misconfigured
    // savings runtime must not 503 legacy webhooks (the savings routes
    // already surface the misconfiguration loudly). The operation still
    // reconciles via the client status path once config is repaired.
    console.warn(
      '[PiggyVest Webhook] Savings outflow reconciliation skipped:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

// Attribution for legacy outflow webhooks: the same references may belong
// to a dispatched primary savings transfer. Reconcile through the shared
// proof so an accepted transfer whose client never polls status still
// confirms; legacy-only references resolve unmatched with no effect.
export async function reconcileSavingsOutflowReferences(
  references: readonly string[],
  deps: SavingsOutflowProcessorDeps
): Promise<'confirmed' | 'cancelled' | 'unmatched'> {
  const savings =
    deps.savingsRuntime === undefined
      ? readSavingsRuntimeForOutflow()
      : deps.savingsRuntime;
  if (!savings) return 'unmatched';
  const outcome = await runPrimaryWalletSavingsOutflowReconciliation({
    configuration: savings.reconciliationConfiguration,
    providerToken: savings.providerToken,
    references,
    fetchImplementation: deps.fetchImplementation,
  });
  if (outcome === 'pending') {
    // The webhook is terminal but the provider re-query cannot confirm
    // yet (propagation lag or ambiguous proof): stay retryable so the
    // redelivery re-runs reconciliation. Resolving here would strand
    // the operation as dispatched with no further trigger.
    throw new Error('Primary savings outflow reconciliation inconclusive');
  }
  return outcome;
}
