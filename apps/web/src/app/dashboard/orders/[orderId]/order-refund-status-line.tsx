import { orderRefundStatusLabels } from '@/config/order-refund';
import type { RefundSummary } from '@/lib/orders/refund-summary';

/**
 * Status heading for the refund card. A cancellation with no queued refund
 * step ("cancel only") leaves the balance outstanding and idle: say so
 * plainly instead of the neutral "Not started", so it never reads as
 * refunded or forgotten.
 */
export function OrderRefundStatusLine({ summary }: { summary: RefundSummary }) {
  const awaitingManualRefund =
    summary.status === 'not_started' &&
    summary.remaining > 0 &&
    summary.canRecordManual === true;
  return (
    <>
      <p role="status" className="font-semibold">
        {awaitingManualRefund
          ? 'Refund pending'
          : (orderRefundStatusLabels[summary.status] ?? summary.status)}
      </p>
      {awaitingManualRefund && (
        <p className="text-sm">
          No automatic refund was queued for this cancellation. Refund the
          customer yourself, then record it with Record manual refund.
        </p>
      )}
    </>
  );
}
