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
  // Paid scope: unpaid (or pending-payment) cancellations have no
  // refundable balance, so skip the card and its status polling rather
  // than rendering a noisy zero-balance Not started panel.
  if (!['Canceled', 'Cancelled'].includes(order.shippingStatus)) return null;
  if (!['Paid', 'Partially Paid', 'Refunded'].includes(order.paymentStatus))
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
