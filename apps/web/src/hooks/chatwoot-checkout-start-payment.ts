import { resolveChatwootCheckoutState } from './chatwoot-checkout-delivery';
import { rememberChatwootCheckoutPayment } from './chatwoot-checkout-memory';
import { initializeChatwootCheckoutBankTransfer } from './chatwoot-checkout-payment';
import { readChatwootCheckoutPaymentStatus } from './chatwoot-checkout-payment-status';
import type {
  ChatwootCheckoutCreatedOrder,
  ChatwootCheckoutFailureCode,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';

export interface StartChatwootCheckoutPaymentInput {
  request: {
    requestId: string;
    customer: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    };
    address: { line1: string; city: string; state: string };
  };
  merchantId: string;
  storeSlug: string;
  order: ChatwootCheckoutCreatedOrder;
  /** Key the order is remembered under; the issued details are stored with it. */
  orderKey: string;
  /** True when earlier bank details for this order have expired. */
  replacesExpiredDetails: boolean;
  canPost: () => boolean;
  postResult: (result: ChatwootCheckoutPlaceResult) => void;
}

/**
 * Sets up the bank transfer for an order the chat created and posts the
 * result. It refuses, with the order number, whenever the chat could not see
 * the payment through: a non-naira order, or one it cannot poll. Before
 * replacing expired details it reads the order first, so an order that was
 * paid or closed in the meantime never gets a second account.
 */
export async function startChatwootCheckoutPayment(
  input: StartChatwootCheckoutPaymentInput
): Promise<void> {
  const { request, order, canPost, postResult } = input;
  const { requestId } = request;
  const fail = (code: ChatwootCheckoutFailureCode) => {
    if (canPost()) {
      postResult({
        requestId,
        status: 'failed',
        code,
        orderNumber: order.orderNumber,
      });
    }
  };
  // Bank transfer is naira-only. A missing currency is not assumed to be NGN.
  if (order.currency !== 'NGN') return fail('payment_unavailable');
  // Without its tracking token the chat could never report the order paid.
  if (!order.trackingToken) return fail('payment_unavailable');

  if (input.replacesExpiredDetails) {
    const current = await readChatwootCheckoutPaymentStatus({
      requestId,
      orderId: order.orderId,
      trackingToken: order.trackingToken,
      merchantSlug: input.storeSlug,
      // The old window has closed; only the order's own state matters here.
      issuedAt: Date.now(),
    });
    if (current.status === 'paid') {
      if (canPost()) {
        postResult({
          requestId,
          status: 'paid',
          orderNumber: order.orderNumber,
        });
      }
      return;
    }
    if (current.status !== 'pending') return fail('payment_unavailable');
  }

  const payment = await initializeChatwootCheckoutBankTransfer({
    merchantId: input.merchantId,
    orderId: order.orderId,
    trackingToken: order.trackingToken,
    customer: request.customer,
    // The order was placed with the canonical state name; bill with the same.
    address: {
      ...request.address,
      state:
        resolveChatwootCheckoutState(request.address.state) ??
        request.address.state,
    },
  });
  if (!payment) return fail('payment_unavailable');
  rememberChatwootCheckoutPayment(input.orderKey, payment);
  if (!canPost()) return;
  postResult({
    requestId,
    status: 'payment_ready',
    orderNumber: order.orderNumber,
    amountMajor: order.amountDueMajor,
    currency: 'NGN',
    bank: payment.bank,
    reference: payment.reference,
  });
}
