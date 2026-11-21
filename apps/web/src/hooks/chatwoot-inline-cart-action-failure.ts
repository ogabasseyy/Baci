import {
  CHATWOOT_CHECKOUT_PLACE_PREFIX,
  CHATWOOT_CHECKOUT_STATUS_PREFIX,
  type ChatwootCheckoutFailureCode,
} from './chatwoot-checkout-result';

type ChatwootActionEvent =
  | 'baci-checkout-place-request'
  | 'baci-checkout-payment-status-request'
  | 'baci-cart-add'
  | 'baci-cart-request'
  | 'baci-cart-quantity'
  | 'baci-product-request'
  | 'baci-checkout-review-request'
  | 'baci-delivery-options-request';

export function postChatwootInlineCartActionFailure(input: {
  event: ChatwootActionEvent;
  requestId: string;
  post: (prefix: string, value: unknown) => void;
  /** Checkout place requests only; defaults to a stale-context failure. */
  checkoutCode?: ChatwootCheckoutFailureCode;
}) {
  if (input.event === 'baci-checkout-place-request') {
    input.post(CHATWOOT_CHECKOUT_PLACE_PREFIX, {
      requestId: input.requestId,
      status: 'failed',
      code: input.checkoutCode ?? 'cart_changed',
    });
  } else if (input.event === 'baci-checkout-payment-status-request') {
    input.post(CHATWOOT_CHECKOUT_STATUS_PREFIX, {
      requestId: input.requestId,
      status: 'unavailable',
    });
  } else if (input.event === 'baci-checkout-review-request') {
    input.post('baci-checkout-review:', {
      requestId: input.requestId,
      status: 'unavailable',
    });
  } else if (input.event === 'baci-delivery-options-request') {
    input.post('baci-delivery-options-result:', {
      requestId: input.requestId,
      status: 'unavailable',
    });
  } else if (input.event === 'baci-cart-request') {
    input.post('baci-cart-view:', {
      requestId: input.requestId,
      ready: false,
      items: [],
    });
  } else if (input.event === 'baci-cart-add') {
    input.post('baci-cart-add-result:', {
      requestId: input.requestId,
      accepted: false,
      code: 'invalid_context',
    });
  } else if (input.event === 'baci-product-request') {
    input.post('baci-product-response:', {
      requestId: input.requestId,
      status: 'unavailable',
      code: 'invalid_context',
    });
  } else {
    input.post('baci-cart-quantity-result:', {
      requestId: input.requestId,
      accepted: false,
    });
  }
}
