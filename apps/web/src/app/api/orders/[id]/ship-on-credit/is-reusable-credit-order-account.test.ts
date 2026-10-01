import { describe, expect, it } from 'vitest';
import { isReusableCreditOrderAccount } from './is-reusable-credit-order-account';

describe('isReusableCreditOrderAccount', () => {
  it('rejects an explicitly expired Paystack account', () => {
    expect(
      isReusableCreditOrderAccount({
        account_name: 'Old customer',
        account_number: '0123456789',
        assigned_at: '2020-01-01T00:00:00.000Z',
        bank_name: 'Wema Bank',
        expires_at: '2020-01-01T00:30:00.000Z',
        provider: 'paystack',
      })
    ).toBe(false);
  });

  it('accepts a Paystack account with a future explicit expiry', () => {
    expect(
      isReusableCreditOrderAccount({
        account_name: 'Current customer',
        account_number: '0123456789',
        bank_name: 'Wema Bank',
        expires_at: '2999-01-01T00:00:00.000Z',
        provider: 'paystack',
      })
    ).toBe(true);
  });
});
