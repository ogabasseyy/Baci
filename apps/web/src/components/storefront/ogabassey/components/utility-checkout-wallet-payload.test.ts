import { describe, expect, it } from 'vitest';
import { buildUtilityCheckoutWalletPayload } from './utility-checkout-wallet-payload';

describe('buildUtilityCheckoutWalletPayload', () => {
  it('merges request fields, payload, and walletAmount', () => {
    expect(
      buildUtilityCheckoutWalletPayload({
        merchantSlug: 'ogabassey',
        customerName: 'Test Customer',
        customerPhone: '08012345678',
        expectedUserId: 'user-1',
        payload: {
          amount: 1000,
          networkProvider: 'MTN',
          phoneNumber: '08012345678',
          type: 'airtime',
        },
      })
    ).toEqual({
      merchantSlug: 'ogabassey',
      customerName: 'Test Customer',
      customerPhone: '08012345678',
      expectedUserId: 'user-1',
      amount: 1000,
      networkProvider: 'MTN',
      phoneNumber: '08012345678',
      type: 'airtime',
      walletAmount: 1000,
    });
  });

  it('omits (not nulls) absent phone and user id', () => {
    // The route treats a present-but-null user id differently from an
    // absent one (binding check), so the keys must be missing — and
    // the signature must match what the submit path signs.
    const built = buildUtilityCheckoutWalletPayload({
      merchantSlug: 'ogabassey',
      customerName: 'Customer',
      customerPhone: null,
      expectedUserId: undefined,
      payload: { amount: 500, type: 'data' },
    });

    expect(built).toEqual({
      merchantSlug: 'ogabassey',
      customerName: 'Customer',
      amount: 500,
      type: 'data',
      walletAmount: 500,
    });
    expect('customerPhone' in built).toBe(false);
    expect('expectedUserId' in built).toBe(false);
  });

  it('omits an empty phone string', () => {
    const built = buildUtilityCheckoutWalletPayload({
      merchantSlug: 'ogabassey',
      customerName: 'Customer',
      customerPhone: '',
      expectedUserId: 'user-1',
      payload: { amount: 500, type: 'data' },
    });

    expect('customerPhone' in built).toBe(false);
    expect(built.expectedUserId).toBe('user-1');
  });
});
