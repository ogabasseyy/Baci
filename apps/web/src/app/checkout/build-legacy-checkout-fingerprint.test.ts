import { describe, expect, it } from 'vitest';
import { buildLegacyCheckoutFingerprint } from './build-legacy-checkout-fingerprint';

const BASE_INPUT = {
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerName: 'Ada Buyer',
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
} as Parameters<typeof buildLegacyCheckoutFingerprint>[0];

describe('buildLegacyCheckoutFingerprint', () => {
  it('is stable for an identical checkout', () => {
    expect(buildLegacyCheckoutFingerprint(BASE_INPUT)).toBe(
      buildLegacyCheckoutFingerprint({ ...BASE_INPUT })
    );
  });

  it('changes when the code or cart changes', () => {
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

  it('changes when the buyer name or shipping address is corrected', () => {
    const base = buildLegacyCheckoutFingerprint(BASE_INPUT);
    expect(
      buildLegacyCheckoutFingerprint({
        ...BASE_INPUT,
        customerName: 'Ada B. Buyer',
      })
    ).not.toBe(base);
    expect(
      buildLegacyCheckoutFingerprint({
        ...BASE_INPUT,
        shippingAddress: { ...BASE_INPUT.shippingAddress, city: 'Abuja' },
      })
    ).not.toBe(base);
  });
});
