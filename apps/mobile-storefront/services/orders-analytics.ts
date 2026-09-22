import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutOrderCreated } from '@/services/analytics';
import type { CreateOrderRequest, OrderResponse } from './orders.schemas';
import { serializeAfterOrderCreated } from './serialize-after-order-created';

const ORDER_CREATED_CLAIM_EVENT = 'order_created';

export async function trackCreatedOrderOnce(
  order: OrderResponse,
  request: CreateOrderRequest,
  startTime: number,
  paymentMethod?: string
): Promise<void> {
  // Later emissions for this order chain behind this write (see
  // serializeAfterOrderCreated) so the funnel keeps causal order.
  return await serializeAfterOrderCreated(order.order.id, async () => {
    // Scoped to order_created: claiming the legacy bare purchase key here
    // would suppress the verified completion path (which requests that
    // default key before emitting its saved purchase context) and leave
    // customer email, phone, and item data in AsyncStorage indefinitely.
    if (
      !(await claimCheckoutPurchaseTracking(
        order.order.id,
        ORDER_CREATED_CLAIM_EVENT
      ))
    )
      return;

    // The server is authoritative when wallet/savings/quiz-voucher coverage
    // changes the finalized method: attribute creation to it so creation and
    // completion share one funnel (mirrors the web order_created fix).
    const finalizedPaymentMethod =
      typeof order.order.payment_method === 'string' &&
      order.order.payment_method.trim() !== ''
        ? order.order.payment_method
        : undefined;
    trackCheckoutOrderCreated({
      itemCount: request.items.reduce(
        (count, item) => count + item.quantity,
        0
      ),
      orderId: order.order.id,
      orderNumber: order.order.order_number ?? 'N/A',
      durationMs: Date.now() - startTime,
      paymentMethod:
        finalizedPaymentMethod ?? paymentMethod ?? request.payment_method,
      paymentStatus: order.order.payment_status,
      shipping: request.shipping_fee,
      subtotal: request.subtotal,
      tax: request.tax_amount,
      total: order.order.total,
    });
  });
}
