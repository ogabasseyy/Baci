import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

// Mirrors the claim RPC's stale cutoff
// (claim_paystack_cancellation_refund_notifications_v1 dead-letters
// processing rows claimed over 15 minutes ago): keep both identical.
const STALE_CLAIM_MINUTES = 15;

/**
 * Count notification rows the next claim call dead-letters: attempts-
 * exhausted rows plus worker claims stale past the RPC's cutoff. Both
 * terminalize to delivery_uncertain inside the claim, so counting them
 * first is the only operational signal for the transition. Throws
 * refund_notification_claim_failed when either count query fails.
 */
export async function countDeadLetteredPaystackRefundNotifications(
  supabase: Pick<SupabaseClient, 'from'>
): Promise<number> {
  // Rows that burned all five attempts are dead-lettered by the first
  // claim below — in either claimable status, exactly as the RPC's
  // exhausted-CTE matches them. Count them first so the terminal
  // transition is reported instead of happening silently.
  const {
    data,
    count,
    error: exhaustedError,
  } = await supabase
    .from('paystack_cancellation_refund_notifications')
    .select('order_id, event_type', { count: 'exact' })
    .in('status', ['pending', 'failed'])
    .gte('attempts', 5)
    .limit(10);
  if (exhaustedError) throw new Error('refund_notification_claim_failed');
  const exhausted = count ?? 0;
  if (exhausted > 0) {
    logger.error({
      message: 'Paystack cancellation refund notifications exhausted retries',
      exhausted,
      sample: data ?? [],
    });
  }
  // Worker claims stale past the RPC cutoff are dead-lettered by the
  // same claim call. Without this count a dead worker's notification
  // would terminalize silently while the route reports success.
  const {
    data: staleData,
    count: staleCount,
    error: staleError,
  } = await supabase
    .from('paystack_cancellation_refund_notifications')
    .select('order_id, event_type', { count: 'exact' })
    .eq('status', 'processing')
    .lt(
      'claimed_at',
      new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString()
    )
    .limit(10);
  if (staleError) throw new Error('refund_notification_claim_failed');
  const staleTerminalized = staleCount ?? 0;
  if (staleTerminalized > 0) {
    logger.error({
      message:
        'Paystack cancellation refund notifications lost their worker claim',
      staleTerminalized,
      sample: staleData ?? [],
    });
  }
  return exhausted + staleTerminalized;
}

/**
 * Count terminal notification rows still awaiting operations review.
 * The pre-transition counter above reports rows the next claim call
 * dead-letters, but once the claim moves them to delivery_uncertain
 * they vanish from every signal: later drains keep returning
 * exhausted 0 with a 200 while permanently undeliverable rows sit
 * unacknowledged. This count keeps them visible in logs and payload
 * without joining the 503-triggering exhausted signal — there is no
 * acknowledgement primitive yet, so folding them in would red-light
 * the route forever and mask fresh failures behind stale ones.
 */
export async function countUnresolvedUncertainRefundNotifications(
  supabase: Pick<SupabaseClient, 'from'>
): Promise<number> {
  const {
    data,
    count,
    error: uncertainError,
  } = await supabase
    .from('paystack_cancellation_refund_notifications')
    .select('order_id, event_type', { count: 'exact' })
    .eq('status', 'delivery_uncertain')
    .limit(10);
  if (uncertainError) throw new Error('refund_notification_claim_failed');
  const uncertain = count ?? 0;
  if (uncertain > 0) {
    logger.error({
      message:
        'Paystack cancellation refund notifications await operations review',
      uncertain,
      sample: data ?? [],
    });
  }
  return uncertain;
}
