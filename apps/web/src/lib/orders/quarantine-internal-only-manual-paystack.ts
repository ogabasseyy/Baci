import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { isUnverifiedManualPaystackRefund } from './is-unverified-manual-paystack-refund';
import type { CancellationOrder } from './order-cancellation-side-effect-types';
import { quarantineRefund } from './quarantine-order-cancellation-refund';

/**
 * Internal-only cancellation (cash/store-credit/manual/POD legs) with
 * an unverified manual Paystack claim: no external leg exists to
 * verify provider money against, so quarantine for human review
 * instead of throwing an ordinary failure the drain burns retries on
 * without recourse. With no unverified claim the order is an
 * ordinary cash-like cancellation still awaiting the merchant's
 * manual record: return quietly so the caller defers through the
 * matcher instead of review-blocking every manual action.
 */
export async function quarantineInternalOnlyManualPaystack({
  allLegs,
  order,
  refundRows,
  supabase,
}: {
  allLegs: GatewayPaymentTransaction[];
  order: CancellationOrder;
  refundRows: Array<{ gateway: unknown; metadata: unknown }>;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<void> {
  const unverifiedPaystackLegIds = [
    ...new Set(
      refundRows
        .filter(isUnverifiedManualPaystackRefund)
        .map(
          (row) =>
            (
              row.metadata as {
                payment_transaction_id?: unknown;
              } | null
            )?.payment_transaction_id
        )
        .filter(
          (id): id is string =>
            typeof id === 'string' && allLegs.some((leg) => leg.id === id)
        )
    ),
  ];
  if (unverifiedPaystackLegIds.length === 0) return;
  await quarantineRefund({
    metadata: {
      unverified_manual_paystack_leg_ids: unverifiedPaystackLegIds,
    },
    order,
    preflight: true,
    reason:
      'Manual Paystack refunds on an internal-only order need provider verification; no external leg exists to verify them against',
    supabase,
    transactions: allLegs,
  });
}
