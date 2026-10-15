import type { Dispatch, SetStateAction } from 'react';
import type { Order } from '../actions';
import { OrderRefundPanel } from './order-refund-panel';

// Cancellation predicate plus refund-driven order-state mutation, kept out
// of the order details page so the already oversized page does not grow.
export function OrderRefundSection({
  order,
  setOrder,
}: {
  order: Order;
  setOrder: Dispatch<SetStateAction<Order>>;
}) {
  // Paid scope: unfunded cancellations have no refundable balance, so
  // skip the card and its status polling rather than rendering a noisy
  // zero-balance Not started panel. Bnpl Approved is funded (Credit
  // Direct flips payment_status to bnpl_approved alongside paid), so
  // its cancellations need the same recovery actions when a refund
  // fails or needs manual recording. A Pending order can still be
  // funded (completed gateway legs the sweep never flipped to paid):
  // the server admits recovery whenever amount_paid > 0, so a payment
  // leg with moved money (completed, refund_pending mid-flight, or a
  // self-terminalized refunded leg the claim still finalizes) keeps
  // the panel visible and only truly unfunded orders hide it.
  if (!['Canceled', 'Cancelled'].includes(order.shippingStatus)) return null;
  // Unknown funding (transactions read failed server-side and was
  // logged) fails open: the panel's RPC is the real gate, and hiding
  // recovery on a transient read error strands funded orders.
  const hasFundedPaymentLeg =
    order.transactions === undefined ||
    order.transactions.some(
      (leg) =>
        leg.transaction_type === 'payment' &&
        (leg.status === 'completed' ||
          leg.status === 'refund_pending' ||
          leg.status === 'refunded') &&
        leg.amount > 0
    );
  if (
    !['Paid', 'Partially Paid', 'Refunded', 'Bnpl Approved'].includes(
      order.paymentStatus
    ) &&
    !hasFundedPaymentLeg
  )
    return null;
  return (
    <OrderRefundPanel
      key={order.id}
      orderId={order.id}
      onRefunded={() =>
        setOrder((prev) =>
          prev.paymentStatus === 'Refunded'
            ? prev
            : { ...prev, paymentStatus: 'Refunded' }
        )
      }
    />
  );
}
