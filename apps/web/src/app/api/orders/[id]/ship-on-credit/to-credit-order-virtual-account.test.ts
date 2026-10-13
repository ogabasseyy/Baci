import { describe, expect, it } from 'vitest';
import { toCreditOrderVirtualAccount } from './to-credit-order-virtual-account';

describe('toCreditOrderVirtualAccount', () => {
  it('maps an account to the public virtual-account shape', () => {
    expect(
      toCreditOrderVirtualAccount({
        account_name: 'Baci / Ada',
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
      })
    ).toEqual({
      account_name: 'Baci / Ada',
      account_number: '1234567890',
      bank_name: 'Paystack-Titan',
    });
  });
});
