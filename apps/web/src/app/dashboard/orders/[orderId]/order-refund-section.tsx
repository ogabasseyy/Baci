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
  if (!['Canceled', 'Cancelled'].includes(order.shippingStatus)) return null;
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
