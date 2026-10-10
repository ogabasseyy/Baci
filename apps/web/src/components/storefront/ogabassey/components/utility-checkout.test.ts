import { describe, expect, it } from 'vitest';
import {
  createWalletIdempotencyKey,
  getCheckoutErrorMessage,
  isUtilityCheckoutResponse,
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
});
