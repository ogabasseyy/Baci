import { getContactErrors } from '@/components/storefront/ogabassey/pages/checkout/contact-validation';
import type { CartItem } from '@/hooks/cart';
import { prepareSharedCartCheckout } from '@/hooks/cart/shared-cart-checkout-client';
import { isQuizVoucherCartItem } from '@/lib/checkout/cart-entitlement-sanitizer';
import { formatPhoneToE164 } from '@/lib/phone';
import type { ChatwootCommerceMessage } from '@/schemas/chatwoot-commerce-message';
import { resolveChatwootCheckoutDelivery } from './chatwoot-checkout-delivery';
import { runChatwootCheckoutSerially } from './chatwoot-checkout-in-flight';
import { deriveChatwootCheckoutKeys } from './chatwoot-checkout-keys';
import {
  getChatwootCheckoutRememberedOrder,
  rememberChatwootCheckoutOrder,
  rememberChatwootCheckoutPayment,
} from './chatwoot-checkout-memory';
import type { ChatwootCheckoutMerchant } from './chatwoot-checkout-merchant';
import { postChatwootCheckoutOrder } from './chatwoot-checkout-order-post';
import { buildChatwootCheckoutOrderRequest } from './chatwoot-checkout-order-request';
import { initializeChatwootCheckoutBankTransfer } from './chatwoot-checkout-payment';
import type {
  ChatwootCheckoutCreatedOrder,
  ChatwootCheckoutFailureCode,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';
import { reviewedChatwootCheckoutItems } from './chatwoot-checkout-reviewed-items';
import { isChatwootCheckoutSubtotalBasisEqual } from './chatwoot-checkout-subtotal-basis';

type PlaceData = Extract<
  ChatwootCommerceMessage,
  { event: 'baci-checkout-place-request' }
>['data'];
type CartRef = { cartId: string; version: number } | null;

export interface HandleChatwootCheckoutPlaceInput {
  request: PlaceData;
  storeSlug: string;
  snapshot: {
    cartVersion: number;
    currency: string;
    estimatedTotals: boolean;
    /** Same basis the delivery-options route quoted the shown options on. */
    itemsSubtotalMinor: number;
  };
  authorizedCartId: string;
  requestedCartRef: CartRef;
  getCurrentCartRef: () => CartRef;
  getDisplayCart: () => CartItem[];
  /** Merchant id and fractional VAT rate from the storefront merchant context. */
  getMerchant: () => ChatwootCheckoutMerchant | null;
  /** The action is still the newest one for this live conversation. */
  isCurrent: () => boolean;
  /** The widget frame and conversation are still the ones that asked. */
  canPost: () => boolean;
  postResult: (result: ChatwootCheckoutPlaceResult) => void;
}

export { resetChatwootCheckoutOrderMemory } from './chatwoot-checkout-memory';

async function startPayment(
  input: HandleChatwootCheckoutPlaceInput,
  merchantId: string,
  order: ChatwootCheckoutCreatedOrder,
  orderKey: string
) {
  const { request, postResult, canPost } = input;
  const fail = (code: ChatwootCheckoutFailureCode) => {
    if (canPost()) {
      postResult({
        requestId: request.requestId,
        status: 'failed',
        code,
        orderNumber: order.orderNumber,
      });
    }
  };
  // Bank transfer is naira-only. A missing currency is not assumed to be NGN.
  if (order.currency !== 'NGN') return fail('payment_unavailable');
  const payment = await initializeChatwootCheckoutBankTransfer({
    merchantId,
    orderId: order.orderId,
    trackingToken: order.trackingToken,
    customer: request.customer,
    address: request.address,
  });
  if (!payment) return fail('payment_unavailable');
  rememberChatwootCheckoutPayment(orderKey, payment);
  if (!canPost()) return;
  postResult({
    requestId: request.requestId,
    status: 'payment_ready',
    orderNumber: order.orderNumber,
    amountMajor: order.amountDueMajor,
    currency: 'NGN',
    bank: payment.bank,
    reference: payment.reference,
  });
}

async function placeOrder(input: HandleChatwootCheckoutPlaceInput) {
  const { request } = input;
  const fail = (code: ChatwootCheckoutFailureCode) => {
    if (input.canPost()) {
      input.postResult({
        requestId: request.requestId,
        status: 'failed',
        code,
      });
    }
  };
  const merchant = input.getMerchant();
  if (!merchant) return fail('order_failed');
  const keys = await deriveChatwootCheckoutKeys(request.requestId, merchant.id);
  if (!keys) return fail('order_failed');
  // One at a time per request: a duplicate that arrives mid-flight waits, then
  // answers from what the first one remembered instead of racing it into a
  // second payment setup.
  return runChatwootCheckoutSerially(keys.idempotencyKey, () =>
    placeForKeys(input, merchant, keys)
  );
}

async function placeForKeys(
  input: HandleChatwootCheckoutPlaceInput,
  merchant: ChatwootCheckoutMerchant,
  keys: { idempotencyKey: string; operationId: string }
) {
  const { request, snapshot, authorizedCartId, requestedCartRef } = input;
  const fail = (code: ChatwootCheckoutFailureCode) => {
    if (input.canPost()) {
      input.postResult({
        requestId: request.requestId,
        status: 'failed',
        code,
      });
    }
  };

  const remembered = getChatwootCheckoutRememberedOrder(keys.idempotencyKey);
  if (remembered) {
    // A replay answers for the merchant the order was created for, never for
    // whichever merchant context the page has since moved to.
    if (remembered.merchantId !== merchant.id) return fail('order_failed');
    // Bank details already issued are returned as they were: asking again
    // could mint a second account and reference for the same order.
    if (remembered.payment) {
      if (input.canPost()) {
        input.postResult({
          requestId: request.requestId,
          status: 'payment_ready',
          orderNumber: remembered.order.orderNumber,
          amountMajor: remembered.order.amountDueMajor,
          currency: 'NGN',
          bank: remembered.payment.bank,
          reference: remembered.payment.reference,
        });
      }
      return;
    }
    return startPayment(
      input,
      merchant.id,
      remembered.order,
      keys.idempotencyKey
    );
  }

  const sameCart = () => {
    const current = input.getCurrentCartRef();
    return (
      input.isCurrent() &&
      current?.cartId === authorizedCartId &&
      current.version === request.cartVersion
    );
  };
  if (
    snapshot.estimatedTotals ||
    snapshot.cartVersion !== request.cartVersion ||
    requestedCartRef?.cartId !== authorizedCartId ||
    requestedCartRef.version !== request.cartVersion ||
    !sameCart()
  ) {
    return fail('cart_changed');
  }
  if (snapshot.currency !== 'NGN') return fail('delivery_unavailable');
  // The order API commits (and completes the cart) before the payment route
  // can refuse bank transfer, so apply the store checkout's gate up front.
  if (!merchant.bankTransferAvailable) return fail('payment_unavailable');
  if (
    Object.keys(
      getContactErrors({
        firstName: request.customer.firstName,
        lastName: request.customer.lastName,
        customerEmail: request.customer.email,
        customerPhone: request.customer.phone,
      })
    ).length > 0
  ) {
    return fail('details_invalid');
  }
  // The dedicated-account route only serves Nigerian customers; refuse before
  // an order exists that could never be paid this way.
  if (!formatPhoneToE164(request.customer.phone).startsWith('+234')) {
    return fail('details_invalid');
  }

  const display = input.getDisplayCart();
  // Chat checkout is bank transfer only: a quiz voucher can leave nothing to
  // pay and the order API would finalize it as already paid.
  if (display.some(isQuizVoucherCartItem)) return fail('cart_unsupported');
  if (
    !isChatwootCheckoutSubtotalBasisEqual(display, snapshot.itemsSubtotalMinor)
  ) {
    return fail('cart_unsupported');
  }
  const delivery = await resolveChatwootCheckoutDelivery({
    merchantId: merchant.id,
    customer: request.customer,
    address: request.address,
    choice: request.delivery,
    quoteItems: display.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      negotiatedPrice: item.negotiatedPrice,
    })),
    cartSubtotal: snapshot.itemsSubtotalMinor / 100,
  });
  if (!delivery.ok) return fail(delivery.code);
  if (!sameCart()) return fail('cart_changed');

  const prepared = await prepareSharedCartCheckout(
    {
      cartId: authorizedCartId,
      expectedVersion: request.cartVersion,
      operationId: keys.operationId,
    },
    input.storeSlug
  );
  if (!prepared.ok) {
    return fail(
      prepared.code === 'refresh_required' ? 'cart_changed' : 'order_failed'
    );
  }
  const { review } = prepared;
  if (review.lines.some((line) => line.voucherToken || line.voucherAwardId)) {
    return fail('cart_unsupported');
  }
  const items = reviewedChatwootCheckoutItems(review, display);
  if (
    !items ||
    review.cartId !== authorizedCartId ||
    review.cartVersion !== request.cartVersion ||
    review.merchantId !== merchant.id ||
    !sameCart()
  ) {
    return fail('cart_changed');
  }

  const outcome = await postChatwootCheckoutOrder(
    buildChatwootCheckoutOrderRequest(
      {
        review,
        display,
        delivery,
        customer: request.customer,
        taxRate: merchant.taxRate,
      },
      items
    ),
    keys.idempotencyKey
  );
  if (!outcome.ok) return fail(outcome.code);
  rememberChatwootCheckoutOrder(
    keys.idempotencyKey,
    merchant.id,
    outcome.order
  );
  return startPayment(input, merchant.id, outcome.order, keys.idempotencyKey);
}

/** Places the order and starts the bank-transfer payment for one widget request. */
export async function handleChatwootCheckoutPlace(
  input: HandleChatwootCheckoutPlaceInput
): Promise<void> {
  try {
    await placeOrder(input);
  } catch {
    if (input.canPost()) {
      input.postResult({
        requestId: input.request.requestId,
        status: 'failed',
        code: 'order_failed',
      });
    }
  }
}
