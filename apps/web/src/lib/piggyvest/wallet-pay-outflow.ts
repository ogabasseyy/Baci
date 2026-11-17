import 'server-only';
import { piggyvestWalletPaySchemas as schemas } from '@/schemas/piggyvest-wallet-pay';
import { readWalletPayRecoveryRuntime } from './wallet-pay-runtime';
import { reconcileWalletPayReferences } from './wallet-pay-service';

/**
 * Outflow webhook attribution for wallet pay transfers (pvb-pay-... payments
 * and pvb-refund-... refunds). It runs under the recovery runtime, so a
 * switched-off feature still settles what PiggyVest already accepted.
 * References that are not ours resolve 'unmatched' without touching any
 * configuration. For OUR reference, anything inconclusive (PiggyVest not yet
 * indexed, configuration broken) throws so the webhook stays retryable
 * instead of being marked processed with the transfer still unsettled.
 */
export async function reconcileWalletPayOutflowReferences(
  references: readonly string[]
): Promise<'confirmed' | 'cancelled' | 'unmatched'> {
  const ours = references.filter(
    (reference) => schemas.reference.safeParse(reference).success
  );
  if (ours.length === 0) return 'unmatched';
  const outcome = await reconcileWalletPayReferences({
    runtime: readWalletPayRecoveryRuntime(),
    references: ours,
  });
  if (outcome === 'pending')
    throw new Error('Wallet pay outflow reconciliation inconclusive');
  if (outcome === 'released') return 'cancelled';
  if (outcome === 'unmatched') return 'unmatched';
  // confirmed, needs_review (recorded for a person) and refunding (a duplicate
  // payment whose refund is now owed) are all concluded for the webhook.
  return 'confirmed';
}
