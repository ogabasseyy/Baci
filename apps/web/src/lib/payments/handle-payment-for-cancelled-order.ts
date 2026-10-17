import 'server-only';

import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';

const RECONCILIATION_ISSUE_TYPE = 'payment_received_after_cancellation';
const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * The minimal order shape needed to decide whether a finalizer's order UPDATE
 * was clamped by the `prevent_cancelled_order_reopen` BEFORE-UPDATE trigger.
 *
 * Because Postgres reflects BEFORE-trigger edits to NEW in `UPDATE ... RETURNING`,
 * a finalizer that asks to advance an already-cancelled order receives the
 * CLAMPED row back: `shipping_status` stays `'cancelled'` (and `cancelled_at`
 * remains set). Either signal marks the order as still cancelled.
 */
export interface CancellableOrderRow {
  cancelled_at?: string | null;
  id: string;
  shipping_status?: string | null;
}

/**
 * Returns true when the returned order row shows the reopen was clamped — i.e.
 * the order is still cancelled despite the finalizer asking to advance it.
 *
 * Plain boolean (not a type guard) so it does not narrow the order variable in
 * a finalizer's non-cancelled `else` branch. Callers that need a non-null row
 * should guard with `order && isOrderClampedAsCancelled(order)`.
 */
export function isOrderClampedAsCancelled(
  order: CancellableOrderRow | null | undefined
): boolean {
  if (!order) {
    return false;
  }
  return (
    order.shipping_status === 'cancelled' ||
    order.shipping_status === 'canceled' ||
    Boolean(order.cancelled_at)
  );
}

/**
 * Records a `payment_received_after_cancellation` reconciliation_review row so
 * ops can issue a manual refund, and logs a warning. The DB trigger already
 * kept the order cancelled; this only stops the cosmetic/operational damage of
 * a paid-order finalizer running on a cancelled order.
 *
 * A sibling partial unique index on `reconciliation_review` makes a webhook
 * retry a benign `23505` no-op — the operator already has the first-fired row.
 *
 * Uses a service-role client for the insert: `reconciliation_review` is
 * RLS-locked to `service_role`, and the callers span service, authenticated, and
 * anon webhook clients — a caller's own client would have its insert silently
 * denied by RLS. This is a server-only ops/audit write, never user-facing.
 *
 * Never throws: the caller must still return a 2xx to the gateway so the
 * webhook is not retried into a loop. The transaction row stays recorded.
 */
export async function handlePaymentForCancelledOrder({
  gatewayReference,
  order,
  reason,
  transactionId,
  issueType = RECONCILIATION_ISSUE_TYPE,
}: {
  gatewayReference: string | null;
  order: CancellableOrderRow;
  reason: string;
  transactionId: string | null;
  // 'payment_received_after_refund' reuses this exact flow for orders that
  // were refunded (not cancelled) before a late gateway payment landed.
  issueType?: string;
  // Resolves true when the reconciliation row is durably filed (inserted or
  // already present). Never throws: webhook callers must still ack. Callers
  // that RETIRE the payment from future reconciliation (the cron sweep's
  // terminal stamp) must gate on this.
}): Promise<boolean> {
  logger.warn({
    cancelledAt: order.cancelled_at ?? null,
    gatewayReference,
    issueType,
    message:
      'Payment finalizer received a payment for an order that must not reopen; suppressing paid-order side effects and filing reconciliation',
    orderId: order.id,
    transactionId,
  });

  const reviewRow = {
    candidates: null,
    issue_type: issueType,
    order_id: order.id,
    paystack_ref: gatewayReference,
    reason,
    txn_id: transactionId,
  };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('reconciliation_review')
      .insert(reviewRow);

    if (!error) {
      return true;
    }

    const isDuplicate =
      (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION;
    if (isDuplicate) {
      logger.info({
        gatewayReference,
        message:
          'payment_received_after_cancellation reconciliation already filed (expected retry no-op)',
        orderId: order.id,
      });
      return true;
    }

    logger.error({
      error,
      gatewayReference,
      message:
        'Failed to file payment_received_after_cancellation reconciliation',
      orderId: order.id,
      transactionId,
    });
  } catch (thrown) {
    // Never throw: the caller must still return 2xx so the webhook is not
    // retried into a loop. The order stays cancelled (trigger) regardless.
    logger.error({
      error: thrown,
      gatewayReference,
      message:
        'Failed to file payment_received_after_cancellation reconciliation (threw)',
      orderId: order.id,
      transactionId,
    });
  }
  return false;
}
