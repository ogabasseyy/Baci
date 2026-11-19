import { expect, it, vi } from 'vitest';
import {
  CHECKOUT_AUTH_CHANGED,
  notifyCheckoutAuthChanged,
} from './checkout-auth-notification';

it('notifies checkout session listeners after sign-in', () => {
  const listener = vi.fn();
  window.addEventListener(CHECKOUT_AUTH_CHANGED, listener);
  try {
    notifyCheckoutAuthChanged();
    expect(listener).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(CHECKOUT_AUTH_CHANGED, listener);
  }
});
