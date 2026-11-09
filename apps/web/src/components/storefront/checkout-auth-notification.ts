export const CHECKOUT_AUTH_CHANGED = 'storefront:checkout-auth-changed';

export function notifyCheckoutAuthChanged() {
  window.dispatchEvent(new Event(CHECKOUT_AUTH_CHANGED));
}
