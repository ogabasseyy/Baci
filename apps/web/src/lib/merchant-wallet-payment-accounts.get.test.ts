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

  it('reads through the fulfil-gated RPC, not the owner-only table', async () => {
    const supabase = client();
    const from = vi.spyOn(supabase, 'from');
    await getMerchantWalletAccount(supabase, 'm');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_merchant_wallet_funding_account',
      { p_merchant_id: 'm' }
    );
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a forbidden read for callers without orders.fulfill', async () => {
    await expect(
      getMerchantWalletAccount(
        client([], { accountRpcError: new Error('forbidden') }),
        'm'
      )
    ).rejects.toThrow('forbidden');
  });

  it('rejects more than one live account like maybeSingle', async () => {
    const row = { account_number: '1234567890', status: 'active' };
    await expect(
      getMerchantWalletAccount(
        client([
          { ...row, account_name: null, bank_name: null },
          { ...row, account_name: null, bank_name: null, status: 'pending' },
        ]),
        'm'
      )
    ).rejects.toThrow('MULTIPLE_FUNDING_ACCOUNTS');
  });
});
