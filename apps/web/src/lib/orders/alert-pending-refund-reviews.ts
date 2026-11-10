import { logger } from '@/lib/logger';
import { alertMerchantOfRefundReview } from '@/lib/orders/alert-merchant-cancellation-refund-review';
import {
  MIN_ALERT_BUDGET_MS,
  REFUND_ALERT_RETRY_CAP,
} from '@/lib/orders/refund-alert-constants';
import { runBounded } from '@/lib/orders/refund-alert-lookup';
import type {
  AlertSupabase,
  RefundAlertPassSummary,
  RefundReviewAlertSenders,
} from '@/lib/orders/refund-alert-types';

// Open reviews examined per pass (newest first) and alerts attempted per
// pass: keeps the cron cost to a few indexed reads plus a bounded number
// of sends.
const REVIEW_SCAN_LIMIT = 50;
const MAX_ALERTS_PER_PASS = 3;
// Hard cap on claim round-trips per pass (duplicates and deferrals included),
// so a page of already-claimed rows cannot cause dozens of writes.
const MAX_CLAIM_ROUND_TRIPS = 10;
// Reviews older than this predate the alert or were left to operations;
// do not page merchants about them retroactively.
const REVIEW_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

// An unconfirmed (uncertain or timed-out) alert is re-driven after this
// cool-down, at most REFUND_ALERT_RETRY_CAP attempts in total.
const RETRY_COOLDOWN_MS = 15 * 60_000;
// Alerts with no usable channel are re-checked this often (no attempts used).
const UNDELIVERABLE_RECHECK_MS = 24 * 60 * 60_000;

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
  supabase: AlertSupabase,
  deadlineMs: number | undefined
): Promise<ActionableReview[] | null | 'timeout' | 'not-deployed'> {
  const now = Date.now();
  const bounded = await runBounded(deadlineMs, (signal) =>
    supabase
      .rpc('list_cancellation_refund_reviews_needing_alert_v1', {
        p_limit: REVIEW_SCAN_LIMIT,
        p_max_attempts: REFUND_ALERT_RETRY_CAP,
        p_retry_before: new Date(now - RETRY_COOLDOWN_MS).toISOString(),
        p_undeliverable_before: new Date(
          now - UNDELIVERABLE_RECHECK_MS
        ).toISOString(),
        p_since: new Date(now - REVIEW_LOOKBACK_MS).toISOString(),
      })
      .abortSignal(signal)
  );
  if (bounded.timedOut) return 'timeout';
  const { data, error } = bounded.value;
  if (error) {
    // The RPC ships with a migration that may not be applied yet: PostgREST
    // PGRST202 / Postgres 42883 (undefined_function). Not a real failure.
    if (error.code === 'PGRST202' || error.code === '42883') {
      return 'not-deployed';
    }
    logger.error({ error, message: 'Refund review alert lookup failed' });
    return null;
  }
  return ((data ?? []) as OpenReview[]).filter(isActionable);
}

let rpcNotDeployedLogged = false;

function deferNotDeployed(
  summary: RefundAlertPassSummary
): RefundAlertPassSummary {
  if (!rpcNotDeployedLogged) {
    rpcNotDeployedLogged = true;
    logger.warn({ message: 'refund alert RPC not deployed yet' });
  }
  summary.deferred += 1;
  return summary;
}

function deferForBudget(
  summary: RefundAlertPassSummary,
  step: string
): RefundAlertPassSummary {
  // Visible in the cron payload: a starved pass must not look like "no work".
  logger.warn({
    message: `Refund review alert pass out of budget before ${step}; deferring`,
  });
  summary.deferred += 1;
  return summary;
}

function deferPass(
  summary: RefundAlertPassSummary,
  step: string
): RefundAlertPassSummary {
  // Timed out against the phase deadline: nothing was claimed; retry next pass.
  logger.warn({
    message: `Refund review alert ${step} timed out; deferring pass`,
  });
  summary.deferred += 1;
  return summary;
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
}): Promise<RefundAlertPassSummary> {
  const summary: RefundAlertPassSummary = {
    alerted: 0,
    attempted: 0,
    deferred: 0,
    duplicate: 0,
    failed: 0,
    uncertain: 0,
    undeliverable: 0,
  };
  const outOfBudget = () =>
    deadlineMs !== undefined && deadlineMs - Date.now() < MIN_ALERT_BUDGET_MS;
  try {
    if (outOfBudget()) return deferForBudget(summary, 'review lookup');
    const pending = await loadReviewsNeedingAlert(supabase, deadlineMs);
    if (pending === 'timeout') return deferPass(summary, 'review lookup');
    if (pending === 'not-deployed') return deferNotDeployed(summary);
    if (pending === null) {
      summary.failed += 1;
      return summary;
    }
    if (pending.length === 0) return summary;
    if (outOfBudget()) return deferForBudget(summary, 'context lookup');
    const orderIds = [...new Set(pending.map((r) => r.order_id))];
    const merchantIds = [...new Set(pending.map((r) => r.merchant_id))];
    const context = await runBounded(deadlineMs, (signal) =>
      Promise.all([
        supabase
          .from('orders')
          .select('id, merchant_id, order_number, currency')
          .in('id', orderIds)
          .abortSignal(signal),
        supabase
          .from('merchants')
          .select('id, email')
          .in('id', merchantIds)
          .abortSignal(signal),
      ])
    );
    if (context.timedOut) return deferPass(summary, 'context lookup');
    const [
      { data: orders, error: ordersError },
      { data: merchants, error: merchantsError },
    ] = context.value;
    if (ordersError || merchantsError) {
      logger.error({
        contextErrors: [ordersError?.message, merchantsError?.message].filter(
          Boolean
        ),
        message: 'Refund review alert context lookup failed',
      });
      summary.failed += 1;
      return summary;
    }
    if (outOfBudget()) return deferForBudget(summary, 'alert sends');
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
    let roundTrips = 0;
    for (const review of pending) {
      if (
        summary.attempted >= MAX_ALERTS_PER_PASS ||
        roundTrips >= MAX_CLAIM_ROUND_TRIPS
      ) {
        break;
      }
      const order = orderById.get(review.order_id);
      const merchant = merchantById.get(review.merchant_id);
      // Tenant check: the review, order, and merchant must agree.
      if (!order || !merchant || order.merchant_id !== merchant.id) continue;
      roundTrips += 1;
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
      // Only genuine attempts use a slot: invalid rows and duplicate claims
      // (another worker owns them) cannot starve older valid reviews.
      if (result === 'duplicate') {
        summary.duplicate += 1;
        continue;
      }
      summary.attempted += 1;
      if (result === 'delivered') summary.alerted += 1;
      else if (result === 'failed' || result === 'skipped') summary.failed += 1;
      else if (result === 'uncertain') summary.uncertain += 1;
      else if (result === 'undeliverable') summary.undeliverable += 1;
      else if (result === 'deferred') {
        summary.deferred += 1;
        break;
      }
    }
  } catch (error) {
    logger.error({ error, message: 'Refund review alert pass failed' });
    summary.failed += 1;
  }
  return summary;
}
