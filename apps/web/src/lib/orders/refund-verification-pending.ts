import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CANCELLATION_DRAIN_FETCH_LIMIT,
  CANCELLATION_DRAIN_MAX_ATTEMPTS,
} from '@/lib/orders/drain-failed-order-cancellation-side-effects';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';

type ProbeClient = Pick<SupabaseClient, 'from'>;

// Leg-check ceiling: the limit applies after the gateway filter,
// so this only needs to exceed any plausible run of impostor rows
// (values containing "paystack" that do not normalize to it)
// ahead of a true Paystack leg.
const PROBE_LEG_LIMIT = 25;

/**
 * Whether any cancelled order has an unsettled refund step with a
 * funded Paystack leg that may need provider verification. The
 * cron route caps the reconcile phase when this is true so the
 * 76s preflight budget survives: without the reservation a full
 * reconcile leaves ~30s and every verification defers on every
 * backlog invocation. Mirrors the drain's per-status selection
 * (oldest-first, same fetch ceiling, same attempts cap) so a
 * Paystack step the drain will select is always inside the probed
 * slice: an unfiltered limit could fill with manual orders and
 * miss it, permitting the full reconcile that starves it. Three
 * small indexed reads plus the leg check; fails closed (false) on
 * any read error so a probe outage never shortens reconciliation.
 */
export async function isRefundVerificationPending(
  supabase: ProbeClient
): Promise<boolean> {
  const failed = await supabase
    .from('order_cancellation_side_effects')
    .select('order_id')
    .eq('step', 'refund')
    .eq('status', 'failed')
    .lt('attempts', CANCELLATION_DRAIN_MAX_ATTEMPTS)
    .order('claimed_at', { ascending: true })
    .limit(CANCELLATION_DRAIN_FETCH_LIMIT);
  if (failed.error || !failed.data) {
    return false;
  }
  const deferred = await supabase
    .from('order_cancellation_side_effects')
    .select('order_id')
    .eq('step', 'refund')
    .eq('status', 'deferred')
    .order('claimed_at', { ascending: true })
    .limit(CANCELLATION_DRAIN_FETCH_LIMIT);
  if (deferred.error || !deferred.data) {
    return false;
  }
  const orderIds = [
    ...new Set(
      [...failed.data, ...deferred.data]
        .map((step) => step.order_id)
        .filter((id) => id !== null)
    ),
  ];
  if (orderIds.length === 0) {
    return false;
  }
  // Prefilter loosely (%paystack% catches padded legacy gateways);
  // the exact normalized match below drops impostors. The limit
  // applies after the gateway filter, so any Paystack-backed order
  // in the slice is detected.
  const { data: legs, error: legsError } = await supabase
    .from('transactions')
    .select('gateway')
    .in('order_id', orderIds)
    .eq('transaction_type', 'payment')
    .in('status', ['completed', 'refund_pending', 'refunded'])
    .gt('amount', 0)
    .ilike('gateway', '%paystack%')
    .limit(PROBE_LEG_LIMIT);
  if (legsError || !legs) {
    return false;
  }
  return legs.some(
    (leg) => normalizePaymentGateway(leg.gateway) === 'PAYSTACK'
  );
}
