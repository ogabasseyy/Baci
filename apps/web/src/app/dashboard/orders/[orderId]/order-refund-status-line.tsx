import { orderRefundStatusLabels } from '@/config/order-refund';
import type { RefundSummary } from '@/lib/orders/refund-summary';

/**
 * Status heading for the refund card. A cancellation with no queued refund
 * step ("cancel only") leaves the balance outstanding and idle: say so
 * plainly instead of the neutral "Not started", so it never reads as
 * refunded or forgotten.
 */
export function OrderRefundStatusLine({ summary }: { summary: RefundSummary }) {
  // Everyone viewing the order sees why it is pending; only the action
  // button (in the panel) is gated on canRecordManual.
  const awaitingManualRefund =
    summary.cancellationRefundMode === 'manual' &&
    summary.status === 'not_started' &&
    summary.remaining > 0;
  if (summary.cancellationRefundMode === 'unknown') {
    return (
      <p role="status" className="font-semibold">
        Refund status unavailable. Reload the page, and check the refund history
        before refunding the customer yourself.
      </p>
    );
  }
  return (
    <>
      <p role="status" className="font-semibold">
        {awaitingManualRefund
          ? 'Refund pending'
          : (orderRefundStatusLabels[summary.status] ?? summary.status)}
      </p>
      {awaitingManualRefund && (
        <p className="text-sm">
          No automatic refund was queued for this cancellation.
          {summary.canManageRefunds === true && summary.canRecordManual === true
            ? ' Refund the customer yourself, then record it with Record manual refund.'
            : ' The store owner or staff with refund permission needs to refund the customer and record it.'}
        </p>
      )}
    </>
  );
}
