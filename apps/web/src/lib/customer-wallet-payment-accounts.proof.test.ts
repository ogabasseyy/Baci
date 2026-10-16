import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCustomerWalletPaymentAccount } from '@/lib/customer-wallet-payment-accounts';
import {
  createDedicatedAccountForWallet,
  createOrGetCustomer,
  getDedicatedAccounts,
} from '@/lib/paystack';
import {
  createInsertQuery,
  createMaybeSingleQuery,
  createSelectRowsQuery,
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

describe('customer wallet payment account provider proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [],
    });
  });

  it('stores an existing Paystack DVA only when Paystack proves the same subaccount', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_existing',
        email: 'jane@example.com',
        first_name: 'Jane',
        id: 100,
        last_name: 'Doe',
        phone: '+2348012345678',
      },
    });
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [
        {
          account_name: 'Ogabassey/Jane Doe',
          account_number: '3333333333',
          active: true,
          assigned: true,
          bank: { id: 1, name: 'Titan Paystack', slug: 'titan-paystack' },
          created_at: '2026-05-21T09:00:00.000Z',
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_existing',
            email: 'jane@example.com',
            first_name: 'Jane',
            id: 100,
            last_name: 'Doe',
          },
          id: 99,
          metadata: null,
          split_config: { subaccount: 'ACCT_merchant123' },
          updated_at: '2026-05-21T09:00:00.000Z',
        } as never,
      ],
    });

    const accountQuery = createMaybeSingleQuery(null);
    const orderAliasQuery = createSelectRowsQuery([]);
    const { insert, query: insertQuery } = createInsertQuery({
      ...existingAccountRow,
      account_number: '3333333333',
      bank_name: 'Titan Paystack',
      bank_slug: 'titan-paystack',
      provider_account_id: '99',
      provider_customer_code: 'CUS_existing',
    });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(accountQuery)
        .mockReturnValueOnce(orderAliasQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant,
        supabase,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountNumber: '3333333333',
        providerSubaccountCode: 'ACCT_merchant123',
      })
    );

    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_number: '3333333333',
        provider_subaccount_code: 'ACCT_merchant123',
      })
    );
  });

  it('stores an existing Paystack DVA when split config is stringified', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_existing',
        email: 'jane@example.com',
        first_name: 'Jane',
        id: 100,
        last_name: 'Doe',
        phone: '+2348012345678',
      },
    });
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [
        {
          account_name: 'Ogabassey/Jane Doe',
          account_number: '3333333333',
          active: true,
          assigned: true,
          bank: { id: 1, name: 'Titan Paystack', slug: 'titan-paystack' },
          created_at: '2026-05-21T09:00:00.000Z',
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_existing',
            email: 'jane@example.com',
            first_name: 'Jane',
            id: 100,
            last_name: 'Doe',
          },
          id: 99,
          metadata: null,
          split_config: '{"subaccount":"ACCT_merchant123"}',
          updated_at: '2026-05-21T09:00:00.000Z',
        } as never,
      ],
    });

    const accountQuery = createMaybeSingleQuery(null);
    const orderAliasQuery = createSelectRowsQuery([]);
    const { insert, query: insertQuery } = createInsertQuery({
      ...existingAccountRow,
      account_number: '3333333333',
      bank_name: 'Titan Paystack',
      bank_slug: 'titan-paystack',
      provider_account_id: '99',
      provider_customer_code: 'CUS_existing',
    });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(accountQuery)
        .mockReturnValueOnce(orderAliasQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant,
        supabase,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        accountNumber: '3333333333',
        providerSubaccountCode: 'ACCT_merchant123',
      })
    );

    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_number: '3333333333',
        provider_subaccount_code: 'ACCT_merchant123',
      })
    );
  });

  it('does not store an existing Paystack DVA without same-subaccount proof', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_existing',
        email: 'jane@example.com',
        first_name: 'Jane',
        id: 100,
        last_name: 'Doe',
        phone: '+2348012345678',
      },
    });
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [
        {
          account_name: 'Ogabassey/Jane Doe',
          account_number: '4444444444',
          active: true,
          assigned: true,
          bank: { id: 1, name: 'Titan Paystack', slug: 'titan-paystack' },
          created_at: '2026-05-21T09:00:00.000Z',
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_existing',
            email: 'jane@example.com',
            first_name: 'Jane',
            id: 100,
            last_name: 'Doe',
          },
          id: 99,
          metadata: null,
          updated_at: '2026-05-21T09:00:00.000Z',
        } as never,
      ],
    });
    vi.mocked(createDedicatedAccountForWallet).mockResolvedValue({
      success: false,
      error: 'Paystack did not prove the DVA subaccount',
      code: 'VALIDATION_ERROR',
    });

    const accountQuery = createMaybeSingleQuery(null);
    const supabase = {
      from: vi.fn().mockReturnValueOnce(accountQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer,
        merchant,
        supabase,
      })
    ).rejects.toMatchObject({
      code: 'PAYSTACK_DVA_ERROR',
    });

    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('returns a recoverable conflict when the wallet DVA aliases an active order DVA', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T10:00:00.000Z'));
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
        accountNumber: '5555555555',
        bankName: 'Test Bank',
        bankSlug: 'test-bank',
        currency: 'NGN',
        providerAccountId: '98',
        providerCustomerCode: 'CUS_new',
        providerSubaccountCode: 'ACCT_merchant123',
      },
    });

    const accountQuery = createMaybeSingleQuery(null);
    const orderAliasQuery = createSelectRowsQuery([
      {
        created_at: '2026-05-21T09:45:00.000Z',
        expires_at: '2026-05-21T11:15:00.000Z',
        order_id: 'order-1',
        orders: { id: 'order-1', payment_status: 'pending' },
      },
    ]);
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(accountQuery)
        .mockReturnValueOnce(orderAliasQuery),
    } as unknown as SupabaseClient;

    try {
      await expect(
        ensureCustomerWalletPaymentAccount({
          consentedAt: new Date('2026-05-20T10:00:00.000Z'),
          customer,
          merchant,
          supabase,
        })
      ).rejects.toMatchObject({
        code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT',
      });

      expect(supabase.from).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
