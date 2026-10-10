import { describe, expect, it } from 'vitest';
import {
  createWalletIdempotencyKey,
  getCheckoutErrorMessage,
  isUtilityCheckoutResponse,
  parseUtilityCheckoutCashback,
} from './utility-checkout';

describe('utility checkout helpers', () => {
  it('returns API failures and a fallback checkout error', () => {
    expect(getCheckoutErrorMessage({ error: 'Insufficient funds' })).toBe(
      'Insufficient funds'
    );
    expect(getCheckoutErrorMessage({})).toBe('Transaction failed');
    expect(getCheckoutErrorMessage('not a checkout response')).toBe(
      'Transaction failed'
    );
  });

  it('validates parsed checkout response fields', () => {
    expect(
      isUtilityCheckoutResponse({
        checkout_url: 'https://checkout.example/pay',
        reference: 'VTU-1',
      })
    ).toBe(true);
    expect(isUtilityCheckoutResponse({ amount: '100' })).toBe(false);
    expect(isUtilityCheckoutResponse([])).toBe(false);
  });

  it('generates UUID idempotency keys for wallet-only submissions', () => {
    expect(createWalletIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('parses well-formed cashback blocks and drops malformed ones', () => {
    expect(
      parseUtilityCheckoutCashback({
        amount: 5,
        credited: true,
        newBalance: 4405,
      })
    ).toEqual({ amount: 5, newBalance: 4405 });
    expect(
      parseUtilityCheckoutCashback({ amount: 'five', newBalance: null })
    ).toBeUndefined();
    expect(parseUtilityCheckoutCashback(null)).toBeUndefined();
    expect(parseUtilityCheckoutCashback(undefined)).toBeUndefined();
  });

  it('drops uncredited cashback blocks so a failed credit never zeroes the balance', () => {
    expect(
      parseUtilityCheckoutCashback({
        amount: 5,
        credited: false,
        newBalance: 0,
      })
    ).toBeUndefined();
  });
});
