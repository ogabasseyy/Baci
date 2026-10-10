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
  // numeric provider ID, so they never match by gateway_reference. Pool
  // their same-currency amounts to account for otherwise-unmatched
  // processed rows; anything left over still quarantines for review.
  // Rows already matched to a processed provider row by reference stay out
  // of the pool so one manual row cannot account twice.
  const processedIds = new Set(
    rows
      .filter((row) => row.status === 'processed')
      .map((row) => String(row.id))
  );
  let manualPaystackKobo = 0;
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
    manualPaystackKobo += kobo;
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
    if (row.status === 'processed' && row.amount <= manualPaystackKobo) {
      manualPaystackKobo -= row.amount;
      continue;
    }
    throw new DeliveryUncertainError(
      'An existing Paystack refund requires reconciliation before retry'
    );
  }
  // Exact accounting: a leftover manual pool means the merchant claimed
  // more Paystack money than the provider confirms. That is either a
  // mis-recorded method or money that never moved — quarantine for review
  // instead of passing on partial coverage.
  if (manualPaystackKobo > 0)
    throw new DeliveryUncertainError(
      'Manual Paystack refunds exceed provider-confirmed amounts; review required'
    );
}
