import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  alertMerchantOfRefundReview,
  MIN_ALERT_BUDGET_MS,
  type RefundReviewAlertSenders,
} from '@/lib/orders/alert-merchant-cancellation-refund-review';

const REVIEW_ISSUE_TYPE = 'order_cancellation_refund_requires_review';
// Open reviews examined per pass (newest first) and alerts attempted per
// pass: keeps the cron cost to a few indexed reads plus a bounded number
// of sends.
const REVIEW_SCAN_LIMIT = 50;
const MAX_ALERTS_PER_PASS = 3;
// Reviews older than this predate the alert or were left to operations;
// do not page merchants about them retroactively.
const REVIEW_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

interface OpenReview {
  candidates: unknown;
  id: string;
  merchant_id: string | null;
  order_id: string | null;
}
type ActionableReview = OpenReview & { merchant_id: string; order_id: string };

function isActionable(review: OpenReview): review is ActionableReview {
  return Boolean(review.order_id && review.merchant_id);
}

async function loadUnalertedReviews(
  supabase: Pick<SupabaseClient, 'from'>
): Promise<ActionableReview[]> {
  const { data, error } = await supabase
    .from('reconciliation_review')
    .select('id, order_id, merchant_id, candidates')
    .eq('issue_type', REVIEW_ISSUE_TYPE)
    .is('resolved_at', null)
    .gte('created_at', new Date(Date.now() - REVIEW_LOOKBACK_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(REVIEW_SCAN_LIMIT);
  if (error) {
    logger.error({ message: 'Refund review alert lookup failed' });
    return [];
  }
  const reviews = ((data ?? []) as OpenReview[]).filter(isActionable);
  if (reviews.length === 0) return [];
  const { data: alerted, error: alertedError } = await supabase
    .from('order_cancellation_refund_alerts')
    .select('review_id')
    .in(
      'review_id',
      reviews.map((review) => review.id)
    );
  if (alertedError) {
    logger.error({ message: 'Refund review alert ledger lookup failed' });
    return [];
  }
  const done = new Set(
    ((alerted ?? []) as Array<{ review_id: string }>).map((r) => r.review_id)
  );
  return reviews.filter((review) => !done.has(review.id));
}

/**
 * Alert merchants about open cancellation-refund reviews that have no
 * alert claim yet. Runs independently of the refund step: filing a review
 * terminalizes the step as delivery_uncertain (and stale-claim quarantine
 * does the same), so those steps never re-run and cannot carry a retry.
 * Instead every drain pass re-scans recent open reviews, which makes a
 * transient push/email outage, or a failed claim or lookup, self-heal.
 * Blind spot: a terminalized refund that filed no review (for example a
 * stale claim quarantined with no review) has nothing to alert from.
 * Never throws; stops when the phase budget (`deadlineMs`) runs short so
 * the notification drain keeps its reserved window.
 */
export async function alertPendingRefundReviews({
  deadlineMs,
  senders,
  supabase,
}: {
  deadlineMs?: number;
  senders?: RefundReviewAlertSenders;
  supabase: Pick<SupabaseClient, 'from'>;
}): Promise<void> {
  try {
    if (
      deadlineMs !== undefined &&
      deadlineMs - Date.now() < MIN_ALERT_BUDGET_MS
    ) {
      return;
    }
    const pending = await loadUnalertedReviews(supabase);
    if (pending.length === 0) return;
    const orderIds = [...new Set(pending.map((r) => r.order_id))];
    const merchantIds = [...new Set(pending.map((r) => r.merchant_id))];
    const [
      { data: orders, error: ordersError },
      { data: merchants, error: merchantsError },
    ] = await Promise.all([
      supabase
        .from('orders')
        .select('id, merchant_id, order_number, currency')
        .in('id', orderIds),
      supabase.from('merchants').select('id, email').in('id', merchantIds),
    ]);
    if (ordersError || merchantsError) {
      logger.error({ message: 'Refund review alert context lookup failed' });
      return;
    }
    const orderById = new Map(
      (
        (orders ?? []) as Array<{
          currency: string | null;
          id: string;
          merchant_id: string;
          order_number: string | null;
        }>
      ).map((o) => [o.id, o])
    );
    const merchantById = new Map(
      ((merchants ?? []) as Array<{ email: string | null; id: string }>).map(
        (m) => [m.id, m]
      )
    );
    let attempted = 0;
    for (const review of pending) {
      if (attempted >= MAX_ALERTS_PER_PASS) break;
      const order = orderById.get(review.order_id);
      const merchant = merchantById.get(review.merchant_id);
      // Tenant check: the review, order, and merchant must agree.
      if (!order || !merchant || order.merchant_id !== merchant.id) continue;
      // Only reviews actually alerted use a slot, so invalid ones cannot
      // starve older valid reviews.
      attempted += 1;
      const result = await alertMerchantOfRefundReview({
        deadlineMs,
        merchant,
        order,
        review,
        senders,
        supabase,
      });
      if (result === 'deferred') return;
    }
  } catch (error) {
    logger.error({ error, message: 'Refund review alert pass failed' });
  }
}
