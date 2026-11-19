const ACTION_EVENTS = new Set([
  'baci-cart-request',
  'baci-cart-add',
  'baci-cart-quantity',
  'baci-product-request',
  'baci-checkout-review-request',
  'baci-delivery-options-request',
]);

export function isChatwootInlineActionEvent(event: string) {
  return ACTION_EVENTS.has(event);
}
