import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

/**
 * Whether any cancelled order has an unsettled refund step with a
 * funded Paystack leg that may need provider verification. The
 * cron route caps the reconcile phase when this is true so the
 * 76s preflight budget survives: without the reservation a full
 * reconcile leaves ~30s and every verification defers on every
 * backlog invocation. Two small indexed reads; fails closed
 * (false) on any read error so a probe outage never shortens
 * reconciliation.
 */
export async function isRefundVerificationPending(
  supabase: Pick<SupabaseClient, 'from'>
): Promise<boolean> {
  const { data: steps, error: stepsError } = await supabase
    .from('order_cancellation_side_effects')
    .select('order_id')
    .eq('step', 'refund')
    .in('status', ['failed', 'deferred'])
    .limit(25);
  if (stepsError || !steps || steps.length === 0) {
    return false;
  }
  const orderIds = [
    ...new Set(steps.map((step) => step.order_id).filter((id) => id !== null)),
  ];
  if (orderIds.length === 0) {
    return false;
  }
  // Prefilter loosely (%paystack% catches padded legacy gateways);
  // the exact normalized match below drops impostors.
  const { data: legs, error: legsError } = await supabase
    .from('transactions')
    .select('gateway')
    .in('order_id', orderIds)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending', 'refunded'])
    .gt('amount', 0)
    .ilike('gateway', '%paystack%')
    .limit(25);
  if (legsError || !legs) {
    return false;
  }
  return legs.some(
    (leg) => normalizePaymentGateway(leg.gateway) === 'PAYSTACK'
  );
}
