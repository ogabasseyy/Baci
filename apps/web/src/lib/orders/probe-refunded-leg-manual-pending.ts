import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefundedLegTerminalAnomaly } from '@/lib/orders/quarantine-refunded-leg-terminal-anomaly';

/**
 * Probe refunded legs even in mixed orders: skipping it would
 * complete past anomalies the SQL gate refuses to finalize. Returns
 * the refunded legs still awaiting merchant manual completion so the
 * caller merges them into the settle deferral: clean siblings
 * initiate first, then the step waits for the merchant instead of
 * completing with money still outstanding. Resolves empty when no
 * refunded leg exists.
 */
export async function probeRefundedLegManualPending({
  actionableLegCount,
  linkLegs,
  order,
  soleCompletedLegId,
  supabase,
}: {
  actionableLegCount: number;
  linkLegs: GatewayPaymentTransaction[];
  order: CancellationOrder;
  soleCompletedLegId: string | null;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<Set<string>> {
  if (actionableLegCount >= linkLegs.length) {
    return new Set<string>();
  }
  const { refundedManualPendingLegIds } =
    await quarantineRefundedLegTerminalAnomaly({
      legs: linkLegs,
      order,
      soleCompletedLegId,
      supabase,
    });
  return refundedManualPendingLegIds;
}
