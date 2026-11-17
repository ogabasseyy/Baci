type ChatwootActionEvent =
  | 'baci-cart-add'
  | 'baci-cart-request'
  | 'baci-cart-quantity'
  | 'baci-product-request'
  | 'baci-checkout-review-request';

export function postChatwootInlineCartActionFailure(input: {
  event: ChatwootActionEvent;
  requestId: string;
  post: (prefix: string, value: unknown) => void;
}) {
  if (input.event === 'baci-checkout-review-request') {
    input.post('baci-checkout-review:', {
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
