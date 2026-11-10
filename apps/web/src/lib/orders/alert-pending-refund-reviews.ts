import { logger } from '@/lib/logger';
import {
  type AlertSupabase,
  alertMerchantOfRefundReview,
  MIN_ALERT_BUDGET_MS,
  REFUND_ALERT_RETRY_CAP,
  type RefundReviewAlertSenders,
} from '@/lib/orders/alert-merchant-cancellation-refund-review';

// Open reviews examined per pass (newest first) and alerts attempted per
// pass: keeps the cron cost to a few indexed reads plus a bounded number
// of sends.
const REVIEW_SCAN_LIMIT = 50;
const MAX_ALERTS_PER_PASS = 3;
// Reviews older than this predate the alert or were left to operations;
// do not page merchants about them retroactively.
const REVIEW_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

// An unconfirmed (uncertain or timed-out) alert is re-driven after this
// cool-down, at most REFUND_ALERT_RETRY_CAP attempts in total.
const RETRY_COOLDOWN_MS = 15 * 60_000;

interface OpenReview {
  alert_attempts: number | null;
  candidates: unknown;
  id: string;
  merchant_id: string | null;
  metadata: unknown;
  order_id: string | null;
}
type ActionableReview = OpenReview & { merchant_id: string; order_id: string };

function isActionable(review: OpenReview): review is ActionableReview {
  return Boolean(review.order_id && review.merchant_id);
}

/**
 * The anti-join against the alert ledger happens in SQL, before the scan
 * limit, so already-alerted reviews can never crowd out older unalerted
 * ones. Unconfirmed claims past the cool-down (under the retry cap) come
 * back too, carrying their attempt count.
 */
async function loadReviewsNeedingAlert(
  supabase: AlertSupabase
): Promise<ActionableReview[]> {
  const now = Date.now();
  const { data, error } = await supabase.rpc(
    'list_cancellation_refund_reviews_needing_alert_v1',
    {
      p_limit: REVIEW_SCAN_LIMIT,
      p_max_attempts: REFUND_ALERT_RETRY_CAP,
      p_retry_before: new Date(now - RETRY_COOLDOWN_MS).toISOString(),
      p_since: new Date(now - REVIEW_LOOKBACK_MS).toISOString(),
    }
  );
  if (error) {
    logger.error({ message: 'Refund review alert lookup failed' });
    return [];
  }
  return ((data ?? []) as OpenReview[]).filter(isActionable);
}

/**
 * Alert merchants about open cancellation-refund reviews that have no
 * confirmed alert (never claimed, or claimed but uncertain past the
 * cool-down and under the retry cap). Runs independently of the refund step: filing a review
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
  senders: RefundReviewAlertSenders;
  supabase: AlertSupabase;
}): Promise<void> {
  try {
    if (
      deadlineMs !== undefined &&
      deadlineMs - Date.now() < MIN_ALERT_BUDGET_MS
    ) {
      return;
    }
    const pending = await loadReviewsNeedingAlert(supabase);
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
        prior:
          review.alert_attempts === null
            ? null
            : { attempts: review.alert_attempts },
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
