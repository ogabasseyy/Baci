import { readChatwootCheckoutPaymentStatus } from './chatwoot-checkout-payment-status';
import type {
  ChatwootCheckoutCreatedOrder,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';

type PaymentReady = Extract<
  ChatwootCheckoutPlaceResult,
  { status: 'payment_ready' }
>;

/**
 * Decides what a repeat gets when its bank details are still within their
 * window. The order is read first: showing the account again for an order
 * that has since been paid could invite a second transfer, and one that was
 * cancelled or cannot be read must not be offered for payment at all.
 */
export async function answerChatwootCheckoutReplay(input: {
  cached: PaymentReady;
  order: ChatwootCheckoutCreatedOrder;
  storeSlug: string;
  issuedAt: number;
}): Promise<ChatwootCheckoutPlaceResult> {
  const { cached, order } = input;
  const current = await readChatwootCheckoutPaymentStatus({
    requestId: cached.requestId,
    orderId: order.orderId,
    trackingToken: order.trackingToken,
    merchantSlug: input.storeSlug,
    issuedAt: input.issuedAt,
  });
  if (current.status === 'paid') {
    return {
      requestId: cached.requestId,
      status: 'paid',
      orderNumber: order.orderNumber,
    };
  }
  if (current.status !== 'pending') {
    return {
      requestId: cached.requestId,
      status: 'failed',
      code: 'payment_unavailable',
      orderNumber: order.orderNumber,
    };
  }
  return cached;
}
