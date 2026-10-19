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
} as Parameters<typeof resolveLegacyCheckoutIdempotencyKey>[0];

describe('legacy checkout idempotency key lifecycle', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('reuses the persisted key across a lost-response retry', async () => {
    const first = await resolveLegacyCheckoutIdempotencyKey(BASE_INPUT);
    const retry = await resolveLegacyCheckoutIdempotencyKey({ ...BASE_INPUT });
    expect(retry).toBe(first);
  });

  it('rotates to a fresh key after the completed checkout clears it', async () => {
    const first = await resolveLegacyCheckoutIdempotencyKey(BASE_INPUT);
    await clearLegacyCheckoutIdempotencyKey(BASE_INPUT);
    const next = await resolveLegacyCheckoutIdempotencyKey({ ...BASE_INPUT });
    expect(next).not.toBe(first);
  });

  it('converges concurrent resolutions on the surviving key', async () => {
    const [first, second] = await Promise.all([
      resolveLegacyCheckoutIdempotencyKey(BASE_INPUT),
      resolveLegacyCheckoutIdempotencyKey(BASE_INPUT),
    ]);
    expect(second).toBe(first);
  });

  it('mints a different key for a different checkout', async () => {
    const first = await resolveLegacyCheckoutIdempotencyKey(BASE_INPUT);
    const other = await resolveLegacyCheckoutIdempotencyKey({
      ...BASE_INPUT,
      discountCode: 'RDM-ZZZ99999',
    });
    expect(other).not.toBe(first);
  });
});
