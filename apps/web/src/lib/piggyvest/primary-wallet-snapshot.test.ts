import { describe, expect, it, vi } from 'vitest';
import { readPrimaryWalletSnapshot } from './primary-wallet-snapshot';

vi.mock('server-only', () => ({}));
function fixture() {
  return {
    businessId: 'business-test',
    loadMapping: vi.fn().mockResolvedValue({
      providerWalletId: 'wallet-test',
      providerCustomerId: 'customer-test',
    }),
    retrieveWallet: vi.fn().mockResolvedValue({
      id: 'wallet-test',
      api_customer_id: 'customer-test',
      business_id: 'business-test',
      currency: 'NGN',
      status: 'active',
      balance: 12345,
    }),
    retrieveAccounts: vi.fn().mockResolvedValue([
      {
        account_number: '0123456789',
        account_name: 'Test Customer',
        bank_name: 'Provider Bank',
      },
    ]),
    verifyMapping: vi.fn().mockResolvedValue(true),
  };
}
describe('primary wallet funding snapshot', () => {
  it('reads the stored wallet and returns provider-owned funding details in kobo', async () => {
    const input = fixture();
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'ready',
      balanceKobo: 12345,
      account: {
        accountNumber: '0123456789',
        accountName: 'Test Customer',
        bankName: 'Provider Bank',
        provider: 'piggyvest',
      },
    });
    expect(input.retrieveWallet).toHaveBeenCalledWith('wallet-test');
    expect(input.retrieveAccounts).toHaveBeenCalledWith('wallet-test');
    expect(input.verifyMapping).toHaveBeenCalledWith({
      mapping: {
        providerWalletId: 'wallet-test',
        providerCustomerId: 'customer-test',
      },
      wallet: {
        id: 'wallet-test',
        api_customer_id: 'customer-test',
        business_id: 'business-test',
        currency: 'NGN',
        status: 'active',
        balance: 12345,
      },
      accounts: [
        {
          account_number: '0123456789',
          account_name: 'Test Customer',
          bank_name: 'Provider Bank',
        },
      ],
    });
  });
  it('never queries the provider without a durable mapping', async () => {
    const input = fixture();
    input.loadMapping.mockResolvedValue(null);
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'pending',
      account: null,
    });
    expect(input.retrieveWallet).not.toHaveBeenCalled();
    expect(input.retrieveAccounts).not.toHaveBeenCalled();
    expect(input.verifyMapping).not.toHaveBeenCalled();
  });
  it.each([
    { id: 'different-wallet' },
    { api_customer_id: 'different-customer' },
    { business_id: 'different-business' },
    { currency: 'USD' },
  ])('does not expose funding details for mismatched wallet evidence %j', async (change) => {
    const input = fixture();
    input.retrieveWallet.mockResolvedValue({
      id: 'wallet-test',
      api_customer_id: 'customer-test',
      business_id: 'business-test',
      currency: 'NGN',
      status: 'active',
      balance: 0,
      ...change,
    });
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'unavailable',
      account: null,
    });
    expect(input.retrieveAccounts).not.toHaveBeenCalled();
    expect(input.verifyMapping).not.toHaveBeenCalled();
  });
  it('waits for an active wallet and valid bank account without inventing details', async () => {
    const input = fixture();
    input.retrieveAccounts.mockResolvedValue([]);
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'pending',
      account: null,
    });
    input.retrieveWallet.mockResolvedValue({
      id: 'wallet-test',
      api_customer_id: 'customer-test',
      business_id: 'business-test',
      currency: 'NGN',
      status: 'pending',
      balance: 0,
    });
    input.retrieveAccounts.mockClear();
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'pending',
      account: null,
    });
    expect(input.retrieveAccounts).not.toHaveBeenCalled();
    expect(input.verifyMapping).not.toHaveBeenCalled();
  });
  it('does not report ready when accepted mapping verification is rejected', async () => {
    const input = fixture();
    input.verifyMapping.mockResolvedValue(false);
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'unavailable',
      account: null,
    });
  });
  it('does not expose funding details when durable verification fails', async () => {
    const input = fixture();
    input.verifyMapping.mockRejectedValue(new Error('private database error'));
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'unavailable',
      account: null,
    });
  });
  it('does not report ready if durable verification was omitted at runtime', async () => {
    const input = fixture();
    Reflect.deleteProperty(input, 'verifyMapping');
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'unavailable',
      account: null,
    });
  });
  it('does not leak provider errors or silently convert fractional balances', async () => {
    const input = fixture();
    input.retrieveWallet.mockRejectedValue(new Error('private provider body'));
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'unavailable',
      account: null,
    });
    input.retrieveWallet.mockResolvedValue({
      id: 'wallet-test',
      api_customer_id: 'customer-test',
      business_id: 'business-test',
      currency: 'NGN',
      status: 'active',
      balance: 1.1,
    });
    expect(await readPrimaryWalletSnapshot(input)).toEqual({
      status: 'unavailable',
      account: null,
    });
  });
});
