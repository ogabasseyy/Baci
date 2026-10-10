import { listPaystackRefunds } from './list-paystack-refunds';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

export async function checkCancellationRefundProvider({
  reference,
  currency,
  knownRefunds,
}: {
  reference: string;
  currency: string;
  knownRefunds: Array<{
    gateway_reference?: string | null;
    status: string;
    amount: number;
    currency?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
}): Promise<void> {
  let rows: Awaited<ReturnType<typeof listPaystackRefunds>>;
  try {
    rows = await listPaystackRefunds(reference);
  } catch {
    throw new DeliveryUncertainError(
      'Unable to verify existing Paystack refunds; review required'
    );
  }
  // Completed manual Paystack refunds carry the merchant reference, not the
  // numeric provider ID, so they never match by gateway_reference. A fungible
  // amount pool cannot attribute which provider refund a manual row refers
  // to, so coverage requires an exact single-row correspondence: each
  // unmatched processed row must pair with exactly one same-currency manual
  // row of the identical amount. Anything else quarantines for review.
  // Rows already matched to a processed provider row by reference stay out
  // of the candidate set so one manual row cannot account twice.
  const processedIds = new Set(
    rows
      .filter((row) => row.status === 'processed')
      .map((row) => String(row.id))
  );
  const manualCandidates: number[] = [];
  for (const item of knownRefunds) {
    if (item.status !== 'completed') continue;
    if (item.metadata?.method !== 'paystack') continue;
    if (item.currency !== currency) continue;
    if (
      item.gateway_reference != null &&
      processedIds.has(item.gateway_reference)
    )
      continue;
    const kobo = Math.round(Number(item.amount) * 100);
    if (!Number.isSafeInteger(kobo) || kobo <= 0) continue;
    manualCandidates.push(kobo);
  }
  for (const row of rows) {
    const known = knownRefunds.find(
      (item) => item.gateway_reference === String(row.id)
    );
    if (
      row.currency !== currency ||
      (known && Math.round(Number(known.amount) * 100) !== row.amount)
    )
      throw new DeliveryUncertainError(
        'Paystack refund amount or currency mismatch'
      );
    if (row.status === 'failed') continue;
    if (known?.status === 'completed' && row.status === 'processed') continue;
    if (row.status === 'processed') {
      const pair = manualCandidates.indexOf(row.amount);
      if (pair !== -1) {
        manualCandidates.splice(pair, 1);
        continue;
      }
    }
    throw new DeliveryUncertainError(
      'An existing Paystack refund requires reconciliation before retry'
    );
  }
  // An unpaired manual candidate means the merchant claimed Paystack money
  // the provider does not confirm. That is either a mis-recorded method or
  // money that never moved — quarantine for review instead of passing.
  if (manualCandidates.length > 0)
    throw new DeliveryUncertainError(
      'Manual Paystack refunds exceed provider-confirmed amounts; review required'
    );
}
