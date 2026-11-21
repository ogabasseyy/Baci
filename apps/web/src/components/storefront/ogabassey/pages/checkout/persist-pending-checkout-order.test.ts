import { afterEach, expect, it, vi } from 'vitest';
import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from './pending-checkout-order';
import { persistPendingCheckoutOrder } from './persist-pending-checkout-order';

const snapshot = {
  orderId: 'existing-order',
  merchantId: 'merchant',
  customerEmail: 'qa@example.com',
  customerPhone: '+2348034096325',
  checkoutFingerprint: 'checkout',
  amountDueToGateway: 12000,
  createdAt: '2026-09-07T12:00:00Z',
};
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it('saves the created order synchronously before redirecting to Paystack', () => {
  persistPendingCheckoutOrder(snapshot);
  expect(
    JSON.parse(
      sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY) || 'null'
    )
  ).toEqual(snapshot);
});
it('does not permit navigation when the pending order cannot be preserved', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => persistPendingCheckoutOrder(snapshot)).toThrow(
    'Unable to save your pending order'
  );
});
