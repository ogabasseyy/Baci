import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLegacyCheckoutFingerprint,
  resolveLegacyCheckoutIdempotencyKey,
} from './checkout-order-idempotency';

const BASE_INPUT = {
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerPhone: '08030000000',
  gateway: 'paystack',
  shippingFee: 1500,
  discountCode: 'RDM-ABCDEF12',
  orderItems: [
    {
      product_id: 'prod-1',
      name: 'Phone',
      quantity: 1,
      price: 5000,
      value: 5000,
    },
  ],
  shippingSelection: {
    selected_quote_id: 'quote-1',
    shipping_carrier: 'GIG Logistics',
    shipping_provider: 'gigl',
    shipping_service_tier: 'standard',
    shipping_session_id: 'session-1',
  },
} as Parameters<typeof buildLegacyCheckoutFingerprint>[0];

describe('legacy checkout idempotency', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('builds a stable fingerprint for an identical checkout', () => {
    expect(buildLegacyCheckoutFingerprint(BASE_INPUT)).toBe(
      buildLegacyCheckoutFingerprint({ ...BASE_INPUT })
    );
  });

  it('changes the fingerprint when the code or cart changes', () => {
    const base = buildLegacyCheckoutFingerprint(BASE_INPUT);
    expect(
      buildLegacyCheckoutFingerprint({ ...BASE_INPUT, discountCode: 'OTHER' })
    ).not.toBe(base);
    expect(
      buildLegacyCheckoutFingerprint({
        ...BASE_INPUT,
        orderItems: [{ ...BASE_INPUT.orderItems[0], quantity: 2 }],
      })
    ).not.toBe(base);
  });

  it('reuses the persisted key across a lost-response retry', async () => {
    const first = await resolveLegacyCheckoutIdempotencyKey(BASE_INPUT);
    const retry = await resolveLegacyCheckoutIdempotencyKey({ ...BASE_INPUT });
    expect(retry).toBe(first);
    expect(
      window.localStorage.getItem('storefront-checkout-idempotency')
    ).toContain(first);
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
