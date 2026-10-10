import type { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayPaymentTransaction } from '@/lib/orders/gateway-payment-transaction';
import type { CancellationOrder } from '@/lib/orders/order-cancellation-side-effect-types';
import { quarantineRefund } from '@/lib/orders/quarantine-order-cancellation-refund';

/**
 * File reconciliation evidence for legs withheld from initiation. Runs
 * after clean legs initiate: each quarantine throws delivery_uncertain,
 * so the step ends under review while the initiated legs settle.
 */
export async function quarantineWithheldCancellationRefundLegs({
  auditBlockedTransactions,
  mismatchedTransactions,
  order,
  supabase,
}: {
  auditBlockedTransactions: GatewayPaymentTransaction[];
  mismatchedTransactions: GatewayPaymentTransaction[];
  order: CancellationOrder;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
}): Promise<void> {
  if (auditBlockedTransactions.length > 0) {
    await quarantineRefund({
      metadata: { audit_blocked_leg_count: auditBlockedTransactions.length },
      order,
      preflight: true,
      reason:
        'A provider refund event for this leg has no verified local audit row; verify it before another provider refund',
      supabase,
      transactions: auditBlockedTransactions,
    });
  }
  if (mismatchedTransactions.length > 0) {
    await quarantineRefund({
      metadata: { mismatched_leg_count: mismatchedTransactions.length },
      order,
      preflight: true,
      reason:
        'Completed cancellation refunds do not cover their payment legs; verify amounts before another provider refund',
      supabase,
      transactions: mismatchedTransactions,
    });
  }
}
