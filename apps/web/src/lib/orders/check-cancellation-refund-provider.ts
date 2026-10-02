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
    if (known?.status !== 'completed' || row.status !== 'processed') {
      throw new DeliveryUncertainError(
        'An existing Paystack refund requires reconciliation before retry'
      );
    }
  }
}
