import { describe, expect, it } from 'vitest';
import { vtuWalletOnlyChargeSchema } from './vtu-wallet-only';

// vtuWalletOnlyChargeSchema is the validation surface for the
// /api/vtu/checkout/wallet-only route. It tightens the base schema by
// REQUIRING walletAmount > 0 (unlike the optional walletAmount on the
// other derived schemas) — a wallet-only request without a positive
// walletAmount is structurally a card-only request that took the
// wrong path. The route additionally enforces walletAmount === amount
// (full-coverage); the schema accepts any positive walletAmount <=
// amount and lets the route reject partial coverage with a clear
// "use the regular initialize endpoint" 4xx.
describe('vtuWalletOnlyChargeSchema', () => {
  // The wallet-only ROUTE injects `source: 'checkout'` into the body
  // before parsing. Mirror that here so these tests reflect what the
  // schema actually sees in production.
  const baseAirtime = {
    merchantSlug: 'ogabassey',
    amount: 1000,
    type: 'airtime' as const,
    phoneNumber: '08012345678',
    networkProvider: 'MTN',
    source: 'checkout' as const,
    expectedUserId: '11111111-2222-4333-8444-555555555555',
  };

  it('accepts walletAmount === amount (the full-coverage happy path)', () => {
    const result = vtuWalletOnlyChargeSchema.safeParse({
      ...baseAirtime,
      walletAmount: 1000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects walletAmount === 0 (the route requires a positive amount)', () => {
    const result = vtuWalletOnlyChargeSchema.safeParse({
      ...baseAirtime,
      walletAmount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects walletAmount > amount via the cross-field rule', () => {
    const result = vtuWalletOnlyChargeSchema.safeParse({
      ...baseAirtime,
      walletAmount: 1500,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing walletAmount (the field is required here)', () => {
    const result = vtuWalletOnlyChargeSchema.safeParse({ ...baseAirtime });
    expect(result.success).toBe(false);
  });

  it('accepts a missing expectedUserId but rejects a malformed one', () => {
    // Codex R137 P1: legacy clients omit the pin (binds to the
    // session user route-side); a present pin must still be a UUID.
    const withId = vtuWalletOnlyChargeSchema.safeParse({
      ...baseAirtime,
      walletAmount: 1000,
    });
    expect(withId.success).toBe(true);

    const { expectedUserId: _omitted, ...withoutIdBody } = baseAirtime;
    expect(_omitted).toBeDefined();
    const withoutId = vtuWalletOnlyChargeSchema.safeParse({
      ...withoutIdBody,
      walletAmount: 1000,
    });
    expect(withoutId.success).toBe(true);

    const invalidId = vtuWalletOnlyChargeSchema.safeParse({
      ...baseAirtime,
      walletAmount: 1000,
      expectedUserId: 'not-a-uuid',
    });
    expect(invalidId.success).toBe(false);
  });

  it('strips a body-supplied orderId instead of persisting it', () => {
    // Codex R96 P1: orderId is server-owned linkage — prepare
    // persists it as order_id without an ownership check, so a UUID
    // from another storefront would create a cross-tenant
    // association. The parse succeeds (unknown-key tolerance) but
    // the parsed input carries no orderId.
    const result = vtuWalletOnlyChargeSchema.safeParse({
      ...baseAirtime,
      walletAmount: 1000,
      orderId: '22222222-3333-4444-8555-666666666666',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('orderId' in result.data).toBe(false);
    }
  });

  it('strips a body-supplied customerId instead of trusting it', () => {
    // Muse R110 LOW: customerId is the same server-owned linkage
    // class as orderId — no wallet-only reader consumes it today,
    // but the parsed input must never carry it, so a future reader
    // cannot inherit a cross-tenant association.
    const result = vtuWalletOnlyChargeSchema.safeParse({
      ...baseAirtime,
      walletAmount: 1000,
      customerId: '33333333-4444-4555-8666-777777777777',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('customerId' in result.data).toBe(false);
    }
  });
});
