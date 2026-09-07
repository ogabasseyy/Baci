import { describe, expect, it, vi } from 'vitest';
import { resolvePendingCheckoutOrder, buildPendingCheckoutFingerprint } from './pending-checkout-order';

const checkout = {
  merchantId: 'merchant-1',
  customerEmail: 'qa@example.com',
  customerName: 'Checkout QA',
  customerPhone: '+2348034096325',
  deliveryMethod: 'door',
  shippingFee: 3518,
  shippingProvider: 'GIGL',
  selectedQuoteId: 'before-paystack',
  shippingAddress: {
    address: '2 Olaide Tomori Street',
    city: 'Ikeja',
    state: 'Lagos',
  },
  items: [
    { product_id: 'product-1', name: 'Phone', quantity: 1, price: 185600 },
  ],
  useWalletCredit: false,
  walletAmountUsed: 0,
};

describe('payment abandonment fingerprint', () => {
  it('reuses checkout identity when shipping refresh returns a new quote UUID at the same price', () => {
    expect(
      buildPendingCheckoutFingerprint({
        ...checkout,
        selectedQuoteId: 'after-paystack',
      })
    ).toBe(buildPendingCheckoutFingerprint(checkout));
  });
  it.each([
    { shippingFee: 2201 },
    { shippingProvider: 'Topship' },
    {
      shippingAddress: {
        address: 'Another street',
        city: 'Ikeja',
        state: 'Lagos',
      },
    },
    { items: [{ ...checkout.items[0], quantity: 2 }] },
    { discountCode: 'SAVE' },
  ])('keeps actual checkout changes distinct: %o', (change) => {
    expect(
      buildPendingCheckoutFingerprint({ ...checkout, ...change })
    ).not.toBe(buildPendingCheckoutFingerprint(checkout));
  });
});


describe('variant changes invalidate a pending checkout', () => {
  it.each([
    { variantId: 'variant-black', variantAttributes: { color: 'blue' } },
    { variantId: 'variant-blue', variantAttributes: { color: 'black' } },
  ])('prevents reuse after variant changes: %j', async (changedVariant) => {
    const original = buildPendingCheckoutFingerprint({ ...checkout, items: [{ ...checkout.items[0], variantId: 'variant-blue', variantAttributes: { color: 'blue' } }] });
    const changed = buildPendingCheckoutFingerprint({ ...checkout, items: [{ ...checkout.items[0], ...changedVariant }] });
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await resolvePendingCheckoutOrder({
      pendingOrder: { orderId: 'old-order', trackingToken: 'token', merchantId: checkout.merchantId, customerEmail: checkout.customerEmail, customerPhone: checkout.customerPhone, checkoutFingerprint: original, amountDueToGateway: 185600, createdAt: '2026-09-07T12:00:00Z' },
      merchantId: checkout.merchantId, customerEmail: checkout.customerEmail, checkoutFingerprint: changed, paymentMethod: 'card', shippingProvider: 'GIGL', fetchImpl,
    });
    expect(changed).not.toBe(original);
    expect(result).toEqual({ reusableOrder: null, clearStoredOrder: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
