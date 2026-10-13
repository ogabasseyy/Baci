import { describe, expect, it } from 'vitest';
import { toVirtualAccount } from './to-virtual-account';

describe('toVirtualAccount', () => {
  it('returns only the public account projection', () => {
    expect(
      toVirtualAccount({
        account_name: 'Ada Lovelace',
        account_number: '1234567890',
        bank_name: 'Wema Bank',
      })
    ).toEqual({
      account_name: 'Ada Lovelace',
      account_number: '1234567890',
      bank_name: 'Wema Bank',
    });
  });
});
