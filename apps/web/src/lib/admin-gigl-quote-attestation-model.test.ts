import { describe, expect, it } from 'vitest';
import {
  type AdminQuoteSnapshot,
  evaluateAdminGiglQuoteBinding,
} from './admin-gigl-quote-attestation-model';

const base: AdminQuoteSnapshot = {
  id: 'quote-1',
  orderId: 'order-1',
  merchantId: 'merchant-1',
  provider: 'GIGL',
  currency: 'NGN',
  pricingVersion: 'gigl_platform_margin_v1',
  price: 11_000,
  providerCost: 10_000,
  platformMargin: 1_000,
  expiresAt: '2030-01-01T00:00:00.000Z',
  isStationPickup: false,
  providerRateId: 'rate-1',
  quoteRequest: {
    admin_order_provenance: 'server_gigl_v1',
    sessionId: 'order-1',
  },
};

function input(
  overrides: Partial<Parameters<typeof evaluateAdminGiglQuoteBinding>[0]> = {}
) {
  return {
    now: '2029-01-01T00:00:00.000Z',
    authUserId: 'owner-user',
    merchantOwnerUserId: 'owner-user',
    order: { id: 'order-1', merchantId: 'merchant-1' },
    quote: base,
    attestation: base,
    ...overrides,
  };
}

describe('deterministic Admin GIGL binder and attestation contract', () => {
  it('rejects a forged provenance string', () => {
    const quote = {
      ...base,
      quoteRequest: { ...base.quoteRequest, admin_order_provenance: 'client' },
    };
    expect(
      evaluateAdminGiglQuoteBinding(input({ quote, attestation: quote }))
    ).toEqual({ ok: false, code: 'invalid_quote_attestation' });
  });
  it('rejects a missing attestation', () => {
    expect(evaluateAdminGiglQuoteBinding(input({ attestation: null }))).toEqual(
      { ok: false, code: 'invalid_quote_attestation' }
    );
  });
  it.each([
    ['order', { orderId: 'other-order' }],
    ['merchant', { merchantId: 'other-merchant' }],
    ['provider', { provider: 'TOPSHIP' }],
    ['currency', { currency: 'USD' }],
    ['pricing version', { pricingVersion: 'old' }],
    ['station pickup', { isStationPickup: true }],
  ])('rejects a quote with the wrong %s', (label, change) => {
    const quote = { ...base, ...change };
    expect(
      evaluateAdminGiglQuoteBinding(input({ quote, attestation: quote }))
    ).toEqual({
      ok: false,
      code:
        label === 'order' || label === 'merchant'
          ? 'order_not_found'
          : 'invalid_quote_attestation',
    });
  });
  it('rejects an expired quote', () => {
    const quote = { ...base, expiresAt: '2028-01-01T00:00:00.000Z' };
    expect(
      evaluateAdminGiglQuoteBinding(input({ quote, attestation: quote }))
    ).toEqual({ ok: false, code: 'invalid_quote_attestation' });
  });
  it.each([
    ['price', { price: 12_000 }],
    ['provider cost', { providerCost: 9_000 }],
    ['platform margin', { platformMargin: 3_000 }],
    ['rate identity', { providerRateId: 'rate-2' }],
    [
      'request',
      { quoteRequest: { ...base.quoteRequest, receiver: { city: 'Abuja' } } },
    ],
  ])('rejects post-attestation %s mutation', (_label, change) => {
    const quote = { ...base, ...change };
    expect(evaluateAdminGiglQuoteBinding(input({ quote }))).toEqual({
      ok: false,
      code: 'invalid_quote_attestation',
    });
  });
  it('returns the binding invariants on a valid quote', () => {
    expect(evaluateAdminGiglQuoteBinding(input())).toEqual({
      ok: true,
      update: {
        selectedQuoteId: 'quote-1',
        shippingProvider: 'GIGL',
        shippingFundingSource: 'merchant_wallet',
      },
    });
  });
  it('rejects unauthenticated and cross-merchant callers', () => {
    expect(evaluateAdminGiglQuoteBinding(input({ authUserId: null }))).toEqual({
      ok: false,
      code: 'forbidden',
    });
    expect(
      evaluateAdminGiglQuoteBinding(
        input({ merchantOwnerUserId: 'other-user' })
      )
    ).toEqual({ ok: false, code: 'forbidden' });
  });
  it('rejects concurrent transition after the first binding', () => {
    const first = evaluateAdminGiglQuoteBinding(input());
    expect(first.ok).toBe(true);
    const second = evaluateAdminGiglQuoteBinding(
      input({
        order: {
          id: 'order-1',
          merchantId: 'merchant-1',
          shippingStatus: 'booked',
        },
      })
    );
    expect(second).toEqual({
      ok: false,
      code: 'order_already_shipped_or_booked',
    });
  });
  it('leaves the order transition untouched on a failed attestation', () => {
    const result = evaluateAdminGiglQuoteBinding(input({ attestation: null }));
    expect(result.ok).toBe(false);
    expect(input().order).toEqual({ id: 'order-1', merchantId: 'merchant-1' });
  });
});
