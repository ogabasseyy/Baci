import type { Dispatch, SetStateAction } from 'react';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { shouldShowOrderRefundPanel } from '@/lib/orders/should-show-order-refund-panel';
import type { Order } from '../actions';
import { OrderRefundPanel } from './order-refund-panel';

// Cancellation predicate plus refund-driven order-state mutation, kept out
// of the order details page so the already oversized page does not grow.
export function OrderRefundSection({
  initialRefundSummary,
  order,
  setOrder,
}: {
  initialRefundSummary?: RefundSummary | null;
  order: Order;
  setOrder: Dispatch<SetStateAction<Order>>;
}) {
  // Visibility shares the page's gate: the server skips the
  // summary fetch exactly when this hides the card.
  if (!shouldShowOrderRefundPanel(order)) return null;
  return (
    <OrderRefundPanel
      key={order.id}
      orderId={order.id}
      initialSummary={initialRefundSummary ?? undefined}
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
