import { describe, expect, it } from 'vitest';
import { getMerchantWalletAccount } from './merchant-wallet-payment-accounts';

describe('merchant-wallet-payment-accounts', () => {
  it('exports the wallet payment account lookup helper', () => {
    expect(typeof getMerchantWalletAccount).toBe('function');
  });
});
