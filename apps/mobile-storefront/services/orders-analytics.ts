import { resolveFinalizedCheckoutPaymentMethod } from '@baci/shared/contracts';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { createLogger } from '@/lib/logger';
import { trackCheckoutOrderCreated } from '@/services/analytics';
import type { CreateOrderRequest, OrderResponse } from './orders.schemas';
import { serializeAfterOrderCreated } from './serialize-after-order-created';

const ORDER_CREATED_CLAIM_EVENT = 'order_created';
const log = createLogger('OrderAnalytics');

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

    // The server is authoritative only when it finalized coverage
    // (resolveFinalizedCheckoutPaymentMethod): attribute creation to it so
    // creation and completion share one funnel. Any other stored/selected
    // mismatch keeps the funnel-start method.
    const expectedPaymentMethod = paymentMethod ?? request.payment_method;
    const finalizedPaymentMethod = resolveFinalizedCheckoutPaymentMethod(
      typeof order.order.payment_method === 'string'
        ? order.order.payment_method
        : undefined,
      expectedPaymentMethod
    );
    // Stamped order currency for funnel attribution: without it every
    // non-NGN creation lands in the NGN funnel while the gateway start
    // and completion paths use the real currency. Absent values keep
    // the builder default.
    const finalizedCurrency =
      typeof order.order.currency === 'string' &&
      order.order.currency.trim() !== ''
        ? order.order.currency
        : undefined;
    trackCheckoutOrderCreated({
      currency: finalizedCurrency,
      itemCount: request.items.reduce(
        (count, item) => count + item.quantity,
        0
      ),
      orderId: order.order.id,
      orderNumber: order.order.order_number ?? 'N/A',
      durationMs: Date.now() - startTime,
      paymentMethod: finalizedPaymentMethod,
      paymentStatus: order.order.payment_status,
      shipping: request.shipping_fee,
      subtotal: request.subtotal,
      tax: request.tax_amount,
      total: order.order.total,
    });
  });
}

/**
 * Fire-and-forget order-created recording: analytics must never hold the
 * order response hostage — a stalled native store would otherwise keep
 * the shopper on the submitting state for an already-committed order
 * (and invite a duplicate retry).
 */
export function recordOrderCreatedAnalytics(
  order: OrderResponse,
  request: CreateOrderRequest,
  startTime: number,
  paymentMethod?: string
): void {
  void trackCreatedOrderOnce(order, request, startTime, paymentMethod).catch(
    (error: unknown) => {
      log.error('Failed to record order-created analytics:', error);
    }
  );
}
