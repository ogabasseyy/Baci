import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCustomerWalletPaymentAccount } from '@/lib/customer-wallet-payment-accounts';
import {
  createDedicatedAccountForWallet,
  createOrGetCustomer,
  getDedicatedAccounts,
} from '@/lib/paystack';
import {
  createMaybeSingleQuery,
  customer,
  existingAccountRow,
  merchant,
} from './customer-wallet-payment-accounts.test-utils';

type PaystackModule = typeof import('@/lib/paystack');

vi.mock('@/lib/paystack', async (importOriginal) => {
  const actual = await importOriginal<PaystackModule>();
  return {
    ...actual,
    createDedicatedAccountForWallet: vi.fn(),
    createOrGetCustomer: vi.fn(),
    getDedicatedAccounts: vi.fn(),
  };
});

describe('customer wallet DVA restricted persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_new',
        email: customer.email,
        first_name: 'Jane',
        id: 100,
        last_name: 'Doe',
        phone: customer.phone,
      },
    });
    vi.mocked(createDedicatedAccountForWallet).mockResolvedValue({
      success: true,
      data: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '2222222222',
        bankName: 'Test Bank',
        bankSlug: 'test-bank',
        currency: 'NGN',
        providerAccountId: '98',
        providerCustomerCode: 'CUS_new',
        providerSubaccountCode: 'ACCT_merchant123',
      },
    });
  });

  it('does not fall back to direct persistence when the restricted writer fails', async () => {
    const supabase = {
      from: vi.fn(() => createMaybeSingleQuery(null)),
    } as unknown as SupabaseClient;
    const writer = vi.fn().mockRejectedValue(new Error('permission denied'));

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant,
        supabase,
        userId: customer.user_id,
        walletDvaWriter: writer,
      })
    ).rejects.toThrow('permission denied');

    expect(writer).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('rejects a writer result that changes provider identity within the owner slot', async () => {
    const supabase = {
      from: vi.fn(() => createMaybeSingleQuery(null)),
    } as unknown as SupabaseClient;
    const writer = vi.fn().mockResolvedValue({
      ...existingAccountRow,
      customerId: customer.id,
      merchantId: merchant.id,
      provider: 'paystack',
      providerCustomerCode: 'CUS_wrong',
      providerSubaccountCode: 'ACCT_merchant123',
      status: 'active',
    });

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant,
        supabase,
        userId: customer.user_id,
        walletDvaWriter: writer,
      })
    ).rejects.toMatchObject({ code: 'WALLET_DVA_STORAGE_ERROR' });
  });
});
