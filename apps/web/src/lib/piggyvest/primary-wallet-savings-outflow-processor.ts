import 'server-only';
import { withEnvelopeReference } from './outflow-envelope-reference';
import { runPrimaryWalletSavingsOutflowReconciliation } from './primary-wallet-savings-outflow-reconciliation';
import {
  readPrimaryWalletSavingsRecoveryRuntime,
  readPrimaryWalletSavingsRuntime,
} from './primary-wallet-savings-runtime';
import { reconcileWalletPayOutflowReferences } from './wallet-pay-outflow';

export interface SavingsOutflowProcessorDeps {
  savingsRuntime?: {
    reconciliationConfiguration: unknown;
    providerToken: unknown;
  } | null;
  fetchImplementation?: typeof fetch;
}

function readSavingsRuntimeForOutflow(): SavingsOutflowProcessorDeps['savingsRuntime'] {
  try {
    // Outflow attribution drains through the recovery runtime when the
    // flags are off so an accepted transfer still confirms after rollback.
    return (
      readPrimaryWalletSavingsRuntime() ??
      readPrimaryWalletSavingsRecoveryRuntime()
    );
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
  eventReferences: readonly string[],
  deps: SavingsOutflowProcessorDeps,
  // The webhook envelope: our own reference for a wallet-to-wallet transfer
  // travels in its pvb_third_party_reference.
  envelope?: unknown
): Promise<'confirmed' | 'cancelled' | 'unmatched'> {
  const references = withEnvelopeReference(eventReferences, envelope);
  const savings =
    deps.savingsRuntime === undefined
      ? readSavingsRuntimeForOutflow()
      : deps.savingsRuntime;
  // Wallet pay (pvb-pay-/pvb-refund-) has its own runtime and references, so
  // it is attributed first and independently of the savings runtime. If it
  // is inconclusive, savings references in the same delivery are still
  // attributed before the delivery is left retryable.
  let walletPayError: unknown = null;
  try {
    const walletPay = await reconcileWalletPayOutflowReferences(references);
    if (walletPay !== 'unmatched') return walletPay;
  } catch (error) {
    walletPayError = error;
  }
  if (!savings) {
    if (walletPayError) throw walletPayError;
    return 'unmatched';
  }
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
  if (outcome === 'unmatched' && walletPayError) throw walletPayError;
  return outcome;
}
