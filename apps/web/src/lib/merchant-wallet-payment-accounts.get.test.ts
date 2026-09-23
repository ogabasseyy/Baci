import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMerchantWalletAccount } from './merchant-wallet-payment-accounts';
import { client } from './merchant-wallet-payment-accounts.test-support';

describe('merchant wallet payment-account provisioning — get', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no active or pending account exists', async () => {
    expect(await getMerchantWalletAccount(client(), 'm')).toBeNull();
  });

  it('maps only safe account fields', async () => {
    const account = await getMerchantWalletAccount(
      client([
        {
          account_name: 'A',
          account_number: '1234567890',
          bank_name: 'B',
          status: 'active',
        },
      ]),
      'm'
    );
    expect(account).toEqual({
      accountName: 'A',
      accountNumber: '1234567890',
      bankName: 'B',
      currency: 'NGN',
      status: 'active',
    });
  });
});
