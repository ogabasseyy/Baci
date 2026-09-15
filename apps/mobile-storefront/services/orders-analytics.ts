import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutOrderCreated } from '@/services/analytics';
import type { CreateOrderRequest, OrderResponse } from './orders.schemas';

export async function trackCreatedOrderOnce(
  order: OrderResponse,
  request: CreateOrderRequest,
  startTime: number,
  paymentMethod?: string
): Promise<void> {
  if (!(await claimCheckoutPurchaseTracking(order.order.id))) return;

  trackCheckoutOrderCreated({
    itemCount: request.items.reduce((count, item) => count + item.quantity, 0),
    orderId: order.order.id,
    orderNumber: order.order.order_number ?? 'N/A',
    durationMs: Date.now() - startTime,
    paymentMethod: paymentMethod || request.payment_method,
    paymentStatus: order.order.payment_status,
    shipping: request.shipping_fee,
    subtotal: request.subtotal,
    tax: request.tax_amount,
    total: order.order.total,
  });
}
