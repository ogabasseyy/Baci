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
  createWalletDvaTestWriter,
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

describe('customer wallet payment account creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [],
    });
  });

  it('returns an existing active account without calling Paystack', async () => {
    const accountQuery = createMaybeSingleQuery(existingAccountRow);
    const supabase = {
      from: vi.fn(() => accountQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant,
        supabase,
        userId: customer.user_id,
        walletDvaWriter: null,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountNumber: '1234567890',
        providerSubaccountCode: 'ACCT_merchant123',
      })
    );

    expect(createOrGetCustomer).not.toHaveBeenCalled();
    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
  });

  it('does not create a provider account when the restricted writer is null or undefined', async () => {
    const accountQuery = createMaybeSingleQuery(null);
    const supabase = {
      from: vi.fn(() => accountQuery),
    } as unknown as SupabaseClient;

    for (const walletDvaWriter of [
      null,
      undefined as unknown as Parameters<
        typeof ensureCustomerWalletPaymentAccount
      >[0]['walletDvaWriter'],
    ]) {
      await expect(
        ensureCustomerWalletPaymentAccount({
          consentedAt: new Date('2026-05-21T10:00:00.000Z'),
          customer,
          merchant,
          supabase,
          userId: customer.user_id,
          walletDvaWriter,
        })
      ).rejects.toMatchObject({ code: 'WALLET_DVA_WRITER_UNAVAILABLE' });
    }

    expect(createOrGetCustomer).not.toHaveBeenCalled();
    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
    expect(getDedicatedAccounts).not.toHaveBeenCalled();
  });

  it('rejects a customer row that is not bound to the authenticated user before Paystack calls', async () => {
    const supabase = {
      from: vi.fn(() => createMaybeSingleQuery(null)),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer: { ...customer, user_id: 'another-user' },
        merchant,
        supabase,
        userId: customer.user_id,
        walletDvaWriter: createWalletDvaTestWriter(),
      })
    ).rejects.toMatchObject({ code: 'WALLET_DVA_STORAGE_ERROR' });

    expect(createOrGetCustomer).not.toHaveBeenCalled();
    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
    expect(getDedicatedAccounts).not.toHaveBeenCalled();
  });

  it('fails closed when the merchant has no Paystack subaccount', async () => {
    const accountQuery = createMaybeSingleQuery(null);
    const supabase = {
      from: vi.fn(() => accountQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant: { ...merchant, paystack_subaccount_code: '   ' },
        supabase,
        userId: customer.user_id,
        walletDvaWriter: null,
      })
    ).rejects.toMatchObject({
      code: 'GATEWAY_NOT_CONFIGURED',
    });

    expect(createOrGetCustomer).not.toHaveBeenCalled();
    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
  });

  it('requires a customer phone before creating a wallet DVA', async () => {
    const accountQuery = createMaybeSingleQuery(null);
    const supabase = {
      from: vi.fn(() => accountQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer: { ...customer, phone: null },
        merchant,
        supabase,
        userId: customer.user_id,
        walletDvaWriter: createWalletDvaTestWriter(),
      })
    ).rejects.toMatchObject({
      code: 'CUSTOMER_PHONE_REQUIRED',
    });

    expect(createOrGetCustomer).not.toHaveBeenCalled();
    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
  });

  it('creates a Paystack wallet DVA and stores it under the merchant subaccount', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_new',
        email: 'jane@example.com',
        first_name: 'Jane',
        id: 100,
        last_name: 'Doe',
        phone: '+2348012345678',
      },
    });
    vi.mocked(createDedicatedAccountForWallet).mockResolvedValue({
      success: true,
      data: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '2222222222',
        bankName: 'Test Bank',
        bankSlug: '   ',
        currency: 'NGN',
        providerAccountId: '98',
        providerCustomerCode: 'CUS_new',
        providerSubaccountCode: 'ACCT_merchant123',
      },
    });

    const accountQuery = createMaybeSingleQuery(null);
    const walletDvaWriter = createWalletDvaTestWriter();
    const supabase = {
      from: vi.fn(() => accountQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant,
        supabase,
        userId: customer.user_id,
        walletDvaWriter,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountNumber: '2222222222',
        providerCustomerCode: 'CUS_new',
        providerSubaccountCode: 'ACCT_merchant123',
      })
    );

    expect(createOrGetCustomer).toHaveBeenCalledWith({
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '+2348012345678',
      metadata: {
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        source: 'wallet_dva',
      },
    });
    expect(createDedicatedAccountForWallet).toHaveBeenCalledWith({
      customerCode: 'CUS_new',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+2348012345678',
      subaccount: 'ACCT_merchant123',
    });
    expect(walletDvaWriter).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '2222222222',
        customerId: 'customer-1',
        bankSlug: null,
        merchantId: 'merchant-1',
        providerSubaccountCode: 'ACCT_merchant123',
        userId: customer.user_id,
      })
    );
  });
});
