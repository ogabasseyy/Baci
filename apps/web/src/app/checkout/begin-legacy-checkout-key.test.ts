import { afterEach, describe, expect, it } from 'vitest';
import { beginLegacyCheckoutKey } from './begin-legacy-checkout-key';
import { resolveLegacyCheckoutIdempotencyKey } from './resolve-legacy-checkout-idempotency-key';

const BASE_INPUT = {
  merchantId: 'merchant-1',
  customerEmail: 'buyer@example.com',
  customerName: 'Ada Buyer',
  customerPhone: '08030000000',
  gateway: 'paystack',
  shippingFee: 1500,
  discountCode: 'SAVE10',
  discountCodeIsLoyalty: false,
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
} as Parameters<typeof beginLegacyCheckoutKey>[0];

describe('beginLegacyCheckoutKey', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('resolves the persisted key for the checkout fingerprint', async () => {
    const session = await beginLegacyCheckoutKey(BASE_INPUT);
    expect(session.idempotencyKey).toBe(
      await resolveLegacyCheckoutIdempotencyKey(session.keyInput)
    );
  });

  it('clears the key on completion for a reusable merchant code', async () => {
    const session = await beginLegacyCheckoutKey(BASE_INPUT);
    await session.completeCheckout();
    const next = await beginLegacyCheckoutKey(BASE_INPUT);
    expect(next.idempotencyKey).not.toBe(session.idempotencyKey);
  });

  it('retains a loyalty BNPL key on completion so the popup can resume', async () => {
    const session = await beginLegacyCheckoutKey({
      ...BASE_INPUT,
      gateway: 'credit_direct',
      discountCode: 'RDM-ABCDEF12',
      discountCodeIsLoyalty: true,
    });
    await session.completeCheckout();
    const resumed = await beginLegacyCheckoutKey({
      ...BASE_INPUT,
      gateway: 'credit_direct',
      discountCode: 'RDM-ABCDEF12',
      discountCodeIsLoyalty: true,
    });
    expect(resumed.idempotencyKey).toBe(session.idempotencyKey);
  });

  it('clears a loyalty key on completion outside BNPL', async () => {
    const session = await beginLegacyCheckoutKey({
      ...BASE_INPUT,
      discountCode: 'RDM-ABCDEF12',
      discountCodeIsLoyalty: true,
    });
    await session.completeCheckout();
    const next = await beginLegacyCheckoutKey({
      ...BASE_INPUT,
      discountCode: 'RDM-ABCDEF12',
      discountCodeIsLoyalty: true,
    });
    expect(next.idempotencyKey).not.toBe(session.idempotencyKey);
  });
});
