import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock(
  '@/components/storefront/ogabassey/pages/checkout/checkout-idempotency',
  () => ({ clearCheckoutIdempotencyKey: mocks.clearKey })
);

import { cleanupOxygenCompletedCheckout } from './oxygen-checkout-cleanup';

const key = 'storefront-checkout-pending-order';
const pending = {
  orderId: 'order-1',
  merchantId: 'merchant-1',
  paymentMethod: 'oxygen',
  checkoutFingerprint: 'fingerprint-1',
};
beforeEach(() => {
  sessionStorage.clear();
  mocks.clearKey.mockClear();
});
it('clears only the matching order recovery and its exact idempotency key', async () => {
  sessionStorage.setItem(key, JSON.stringify(pending));
  sessionStorage.setItem('checkout-form', 'newer form');
  await cleanupOxygenCompletedCheckout('order-1', 'merchant-1');
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(mocks.clearKey).toHaveBeenCalledExactlyOnceWith('fingerprint-1');
  expect(sessionStorage.getItem('checkout-form')).toBe('newer form');
});
it.each([
  { ...pending, orderId: 'other' },
  { ...pending, merchantId: 'other' },
  { ...pending, paymentMethod: 'card' },
  { ...pending, checkoutFingerprint: '' },
])('leaves unmatched or invalid recovery untouched', async (saved) => {
  sessionStorage.setItem(key, JSON.stringify(saved));
  await cleanupOxygenCompletedCheckout('order-1', 'merchant-1');
  expect(sessionStorage.getItem(key)).toBe(JSON.stringify(saved));
  expect(mocks.clearKey).not.toHaveBeenCalled();
});
it('uses the saved local line instances and clears only an unchanged checkout form', async () => {
  const { captureOxygenCheckoutSnapshot } = await import(
    './oxygen-checkout-snapshot'
  );
  sessionStorage.setItem(key, JSON.stringify(pending));
  sessionStorage.setItem('checkout-form', 'original form');
  captureOxygenCheckoutSnapshot('order-1', 'merchant-1', [
    { cartItemId: 'a', cartLineInstanceId: 'original', quantity: 2 },
  ]);
  const complete = vi.fn();
  await cleanupOxygenCompletedCheckout('order-1', 'merchant-1', {
    merchantSlug: 'shop',
    cart: {
      isHydrated: true,
      sharedCartEnabled: false,
      completeOxygenPurchasedLines: complete,
    },
  });
  expect(complete).toHaveBeenCalledWith('shop', [
    { cartItemId: 'a', instanceId: 'original', quantity: 2 },
  ]);
  expect(sessionStorage.getItem('checkout-form')).toBeNull();
});
it('does not touch a delegated cart or a checkout form changed after order creation', async () => {
  const { captureOxygenCheckoutSnapshot } = await import(
    './oxygen-checkout-snapshot'
  );
  sessionStorage.setItem(key, JSON.stringify(pending));
  sessionStorage.setItem('checkout-form', 'original form');
  captureOxygenCheckoutSnapshot('order-1', 'merchant-1', [
    { cartItemId: 'a', cartLineInstanceId: 'original', quantity: 1 },
  ]);
  sessionStorage.setItem('checkout-form', 'new form');
  const complete = vi.fn();
  await cleanupOxygenCompletedCheckout('order-1', 'merchant-1', {
    merchantSlug: 'shop',
    cart: {
      isHydrated: true,
      sharedCartEnabled: true,
      completeOxygenPurchasedLines: complete,
    },
  });
  expect(complete).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('checkout-form')).toBe('new form');
});
it('does not use a captured cart snapshot when the pending order no longer matches', async () => {
  const { captureOxygenCheckoutSnapshot } = await import(
    './oxygen-checkout-snapshot'
  );
  sessionStorage.setItem(
    key,
    JSON.stringify({ ...pending, orderId: 'newer-order' })
  );
  captureOxygenCheckoutSnapshot('order-1', 'merchant-1', [
    { cartItemId: 'a', cartLineInstanceId: 'original', quantity: 1 },
  ]);
  const complete = vi.fn();
  await cleanupOxygenCompletedCheckout('order-1', 'merchant-1', {
    merchantSlug: 'shop',
    cart: {
      isHydrated: true,
      sharedCartEnabled: false,
      completeOxygenPurchasedLines: complete,
    },
  });
  expect(complete).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).not.toBeNull();
  expect(mocks.clearKey).not.toHaveBeenCalled();
});
