import { afterEach, describe, expect, it } from 'vitest';
import { clearLegacyCheckoutIdempotencyKey } from './clear-legacy-checkout-idempotency-key';
import { resolveLegacyCheckoutIdempotencyKey } from './resolve-legacy-checkout-idempotency-key';

const BASE_INPUT = {
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerName: 'Ada Buyer',
  customerPhone: '08030000000',
  gateway: 'paystack',
  shippingFee: 1500,
  discountCode: 'SAVE10',
  orderItems: [
    {
      product_id: 'prod-1',
      name: 'Phone',
      quantity: 1,
      price: 5000,
      value: 5000,
    },
  ],
  shippingAddress: {
    firstName: 'Ada',
    lastName: 'Buyer',
    address: '1 Main Street',
    city: 'Lagos',
    state: 'Lagos',
  },
  shippingSelection: {
    selected_quote_id: 'quote-1',
    shipping_carrier: 'GIG Logistics',
    shipping_provider: 'gigl',
    shipping_service_tier: 'standard',
    shipping_session_id: 'session-1',
  },
} as Parameters<typeof clearLegacyCheckoutIdempotencyKey>[0];

describe('clearLegacyCheckoutIdempotencyKey', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('removes the stored key so the next identical checkout mints fresh', async () => {
    const first = await resolveLegacyCheckoutIdempotencyKey(BASE_INPUT);
    await clearLegacyCheckoutIdempotencyKey(BASE_INPUT);
    expect(
      window.localStorage.getItem('storefront-checkout-idempotency')
    ).toBeNull();
    const next = await resolveLegacyCheckoutIdempotencyKey(BASE_INPUT);
    expect(next).not.toBe(first);
  });

  it('resolves without a stored key', async () => {
    await expect(
      clearLegacyCheckoutIdempotencyKey(BASE_INPUT)
    ).resolves.toBeUndefined();
  });
});
