import { getContactErrors } from '@/components/storefront/ogabassey/pages/checkout/contact-validation';
import type { CartItem } from '@/hooks/cart';
import { prepareSharedCartCheckout } from '@/hooks/cart/shared-cart-checkout-client';
import { calculateCartCatalogSubtotal } from '@/lib/checkout/cart-entitlement-sanitizer';
import type { ChatwootCommerceMessage } from '@/schemas/chatwoot-commerce-message';
import { resolveChatwootCheckoutDelivery } from './chatwoot-checkout-delivery';
import {
  buildChatwootCheckoutOrderRequest,
  type ChatwootCheckoutCreatedOrder,
  deriveChatwootCheckoutKeys,
  postChatwootCheckoutOrder,
  reviewedChatwootCheckoutItems,
} from './chatwoot-checkout-order';
import { initializeChatwootCheckoutBankTransfer } from './chatwoot-checkout-payment';
import type {
  ChatwootCheckoutFailureCode,
  ChatwootCheckoutPlaceResult,
} from './chatwoot-checkout-result';

type PlaceData = Extract<
  ChatwootCommerceMessage,
  { event: 'baci-checkout-place-request' }
>['data'];
type CartRef = { cartId: string; version: number } | null;

export interface HandleChatwootCheckoutPlaceInput {
  request: PlaceData;
  storeSlug: string;
  snapshot: { cartVersion: number; currency: string; estimatedTotals: boolean };
  authorizedCartId: string;
  requestedCartRef: CartRef;
  getCurrentCartRef: () => CartRef;
  getDisplayCart: () => CartItem[];
  /** Merchant id and fractional VAT rate from the storefront merchant context. */
  getMerchant: () => { id: string; taxRate: number } | null;
  /** The action is still the newest one for this live conversation. */
  isCurrent: () => boolean;
  /** The widget frame and conversation are still the ones that asked. */
  canPost: () => boolean;
  postResult: (result: ChatwootCheckoutPlaceResult) => void;
}

/**
 * Orders already created by this page, keyed by the derived idempotency key.
 * A repeat of the same widget request id skips straight to the payment step
 * even if creating the order has since moved the cart version. The server
 * idempotency key still protects a reload or a second tab.
 */
const createdOrders = new Map<string, ChatwootCheckoutCreatedOrder>();
const MAX_REMEMBERED_ORDERS = 20;

function remember(key: string, order: ChatwootCheckoutCreatedOrder) {
  createdOrders.set(key, order);
  if (createdOrders.size > MAX_REMEMBERED_ORDERS) {
    const oldest = createdOrders.keys().next().value;
    if (oldest !== undefined) createdOrders.delete(oldest);
  }
}

/** Test seam: forget remembered orders between cases. */
export function resetChatwootCheckoutOrderMemory() {
  createdOrders.clear();
}

async function startPayment(
  input: HandleChatwootCheckoutPlaceInput,
  merchantId: string,
  order: ChatwootCheckoutCreatedOrder
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
  if (order.currency && order.currency !== 'NGN')
    return fail('payment_unavailable');
  const payment = await initializeChatwootCheckoutBankTransfer({
    merchantId,
    orderId: order.orderId,
    trackingToken: order.trackingToken,
    customer: request.customer,
    address: request.address,
  });
  if (!payment) return fail('payment_unavailable');
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
  const merchant = input.getMerchant();
  const keys = await deriveChatwootCheckoutKeys(
    request.requestId,
    authorizedCartId
  );
  if (!merchant || !keys) return fail('order_failed');

  const remembered = createdOrders.get(keys.idempotencyKey);
  if (remembered) return startPayment(input, merchant.id, remembered);

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

  const display = input.getDisplayCart();
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
    catalogSubtotal: calculateCartCatalogSubtotal(display, true),
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
  remember(keys.idempotencyKey, outcome.order);
  return startPayment(input, merchant.id, outcome.order);
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
