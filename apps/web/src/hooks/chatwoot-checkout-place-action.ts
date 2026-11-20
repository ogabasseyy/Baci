import { getContactErrors } from '@/components/storefront/ogabassey/pages/checkout/contact-validation';
import type { CartItem } from '@/hooks/cart';
import { prepareSharedCartCheckout } from '@/hooks/cart/shared-cart-checkout-client';
import { isQuizVoucherCartItem } from '@/lib/checkout/cart-entitlement-sanitizer';
import { formatPhoneToE164 } from '@/lib/phone';
import type { ChatwootCommerceMessage } from '@/schemas/chatwoot-commerce-message';
import { pinChatwootCheckoutAttribution } from './chatwoot-checkout-attribution';
import { resolveChatwootCheckoutDelivery } from './chatwoot-checkout-delivery';
import { runChatwootCheckoutSerially } from './chatwoot-checkout-in-flight';
import { deriveChatwootCheckoutKeys } from './chatwoot-checkout-keys';
import {
  findChatwootCheckoutOrderForCart,
  getChatwootCheckoutRememberedOrder,
  rememberChatwootCheckoutOrder,
} from './chatwoot-checkout-memory';
import type { ChatwootCheckoutMerchant } from './chatwoot-checkout-merchant';
import { postChatwootCheckoutOrder } from './chatwoot-checkout-order-post';
import { buildChatwootCheckoutOrderRequest } from './chatwoot-checkout-order-request';
import { answerChatwootCheckoutReplay } from './chatwoot-checkout-replay-answer';
import { decideChatwootCheckoutReplay } from './chatwoot-checkout-replay-decision';
import type {
  ChatwootCheckoutFailureCode,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';
import { reviewedChatwootCheckoutItems } from './chatwoot-checkout-reviewed-items';
import { startChatwootCheckoutPayment } from './chatwoot-checkout-start-payment';
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
  // One at a time per cart: a second attempt that arrives mid-flight, under
  // the same or a new request id, waits and then answers from the order the
  // first one placed instead of racing it into a second payment setup.
  return runChatwootCheckoutSerially(
    `${merchant.id}:${input.authorizedCartId}`,
    () => placeForKeys(input, merchant, keys)
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

  const byRequest = getChatwootCheckoutRememberedOrder(keys.idempotencyKey);
  const forCart = byRequest
    ? null
    : findChatwootCheckoutOrderForCart(authorizedCartId);
  const remembered = byRequest ?? forCart?.entry ?? null;
  const paymentBase = {
    request,
    merchantId: merchant.id,
    storeSlug: input.storeSlug,
    orderKey: forCart?.key ?? keys.idempotencyKey,
    canPost: input.canPost,
    postResult: input.postResult,
  };
  if (remembered) {
    const replay = decideChatwootCheckoutReplay(remembered, {
      requestId: request.requestId,
      conversationId: request.conversationId,
      merchantId: merchant.id,
    });
    if (replay.kind === 'refuse') return fail('order_failed');
    if (replay.kind === 'answer') {
      const answer = await answerChatwootCheckoutReplay({
        cached: replay.result,
        order: remembered.order,
        storeSlug: input.storeSlug,
        issuedAt: remembered.payment?.issuedAt ?? 0,
      });
      if (input.canPost()) input.postResult(answer);
      return;
    }
    return startChatwootCheckoutPayment({
      ...paymentBase,
      order: replay.order,
      replacesExpiredDetails: remembered.payment !== null,
    });
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
  // Nothing to transfer: a free cart with free delivery would be finalized by
  // the order route with no payment step for the chat to offer.
  if (snapshot.itemsSubtotalMinor + Math.round(delivery.quote.price * 100) <= 0)
    return fail('cart_unsupported');
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
    // The review re-prices from the catalog: a subtotal the shopper was not
    // shown is not ordered.
    review.subtotalMinor !== snapshot.itemsSubtotalMinor ||
    !sameCart()
  ) {
    return fail('cart_changed');
  }

  const orderRequest = buildChatwootCheckoutOrderRequest(
    {
      review,
      display,
      delivery,
      customer: request.customer,
      taxRate: merchant.taxRate,
    },
    items
  );
  const outcome = await postChatwootCheckoutOrder(
    {
      ...orderRequest,
      // A retry must send the same body even if tracking cookies moved.
      ad_tracking: pinChatwootCheckoutAttribution(
        keys.idempotencyKey,
        orderRequest.ad_tracking
      ),
    },
    keys.idempotencyKey
  );
  if (!outcome.ok) return fail(outcome.code);
  rememberChatwootCheckoutOrder(
    keys.idempotencyKey,
    {
      merchantId: merchant.id,
      conversationId: request.conversationId,
      cartId: authorizedCartId,
    },
    outcome.order
  );
  return startChatwootCheckoutPayment({
    ...paymentBase,
    order: outcome.order,
    replacesExpiredDetails: false,
  });
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
