import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';

/**
 * Quarantine completed legs whose amount is not finite before any
 * provider call. The refund reduction treats NaN as zero while its
 * predicate accepts it, and the refund API omits a non-positive
 * amount — so a corrupt leg would reach the provider as a full
 * refund. Quarantine files the operations review and throws, so the
 * caller never refunds or retries corrupt legs.
 */
export async function quarantineInvalidRefundAmountLegs({
  order,
  supabase,
  transactions,
}: {
  order: CancellationOrder;
  supabase: SupabaseClient;
  transactions: GatewayPaymentTransaction[];
}): Promise<void> {
  const invalidAmountLegs = transactions.filter(
    (transaction) => !Number.isFinite(Number(transaction.amount))
  );
  if (invalidAmountLegs.length === 0) return;
  await quarantineRefund({
    order,
    preflight: true,
    reason:
      'A completed payment leg has an invalid amount; verify it before another provider refund',
    supabase,
    transactions: invalidAmountLegs,
  });
}
