import { describe, expect, it, vi } from 'vitest';
import { resolveStalledWalletPaymentAccount } from './customer-wallet-payment-account-reactivation';
import { CustomerWalletPaymentAccountError } from './customer-wallet-payment-account-types';

function supabaseWithRow(row: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const chain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
    select: vi.fn().mockReturnThis(),
  };
  return {
    from: vi.fn().mockReturnValue({ select: () => chain }),
    chain,
  };
}

const account = {
  providerSubaccountCode: 'subaccount-1',
  providerCustomerCode: 'customer-1',
  accountNumber: '0123456789',
  providerAccountId: 'account-1',
};

describe('resolveStalledWalletPaymentAccount', () => {
  it('returns null when no stalled row exists', async () => {
    const supabase = supabaseWithRow(null);
    await expect(
      resolveStalledWalletPaymentAccount({
        account: account as never,
        consentedAt: new Date(),
        customerId: 'customer',
        merchantId: 'merchant',
        supabase: supabase as never,
      })
    ).resolves.toBeNull();
  });

  it('refuses to reactivate a disabled row', async () => {
    const supabase = supabaseWithRow({
      id: 'row-1',
      status: 'disabled',
      provider_subaccount_code: 'subaccount-1',
    });
    await expect(
      resolveStalledWalletPaymentAccount({
        account: account as never,
        consentedAt: new Date(),
        customerId: 'customer',
        merchantId: 'merchant',
        supabase: supabase as never,
      })
    ).rejects.toMatchObject({ code: 'WALLET_DVA_DISABLED_ACCOUNT' });
  });

  it('refuses a subaccount mismatch', async () => {
    const supabase = supabaseWithRow({
      id: 'row-1',
      status: 'pending_review',
      provider_subaccount_code: 'subaccount-2',
    });
    await expect(
      resolveStalledWalletPaymentAccount({
        account: account as never,
        consentedAt: new Date(),
        customerId: 'customer',
        merchantId: 'merchant',
        supabase: supabase as never,
      })
    ).rejects.toBeInstanceOf(CustomerWalletPaymentAccountError);
  });
});
