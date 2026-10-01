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

vi.mock('@/lib/paystack', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/paystack')>();
  return {
    ...actual,
    createDedicatedAccountForWallet: vi.fn(),
    createOrGetCustomer: vi.fn(),
    getDedicatedAccounts: vi.fn(),
  };
});

describe('customer wallet payment account name selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [],
    });
  });

  it('trims whitespace from local customer names before DVA creation', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_trimmed',
        email: 'jane@example.com',
        first_name: null,
        id: 100,
        last_name: null,
        phone: '+2348012345678',
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
        providerCustomerCode: 'CUS_trimmed',
        providerSubaccountCode: 'ACCT_merchant123',
      },
    });

    const accountQuery = createMaybeSingleQuery(null);
    const orderAliasQuery = createSelectRowsQuery([]);
    const { query: insertQuery } = createInsertQuery({
      ...existingAccountRow,
      account_number: '2222222222',
      provider_customer_code: 'CUS_trimmed',
    });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(accountQuery)
        .mockReturnValueOnce(orderAliasQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    await ensureCustomerWalletPaymentAccount({
      consentedAt: new Date('2026-05-21T10:00:00.000Z'),
      customer: { ...customer, first_name: ' Jane ', last_name: ' Doe ' },
      merchant,
      supabase,
    });

    expect(createDedicatedAccountForWallet).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' })
    );
  });

  it('prefers a complete local name pair over stale provider names', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_existing',
        email: 'jane@example.com',
        first_name: 'OldFirst',
        id: 100,
        last_name: 'OldLast',
        phone: '+2348012345678',
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
        providerCustomerCode: 'CUS_existing',
        providerSubaccountCode: 'ACCT_merchant123',
      },
    });

    const accountQuery = createMaybeSingleQuery(null);
    const orderAliasQuery = createSelectRowsQuery([]);
    const { query: insertQuery } = createInsertQuery({
      ...existingAccountRow,
      account_number: '2222222222',
      provider_customer_code: 'CUS_existing',
    });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(accountQuery)
        .mockReturnValueOnce(orderAliasQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    await ensureCustomerWalletPaymentAccount({
      consentedAt: new Date('2026-05-21T10:00:00.000Z'),
      customer,
      merchant,
      supabase,
    });

    expect(createDedicatedAccountForWallet).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' })
    );
  });

  it('rejects mixed name sources when neither pair is complete', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_mixed_names',
        email: 'jane@example.com',
        first_name: 'ProviderFirst',
        id: 100,
        last_name: null,
        phone: '+2348012345678',
      },
    });

    const accountQuery = createMaybeSingleQuery(null);
    const supabase = {
      from: vi.fn().mockReturnValue(accountQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer: { ...customer, first_name: null, last_name: 'LocalLast' },
        merchant,
        supabase,
      })
    ).rejects.toMatchObject({
      code: 'CUSTOMER_NAME_REQUIRED',
    });

    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
  });

  it('uses provider customer names when local profile names are missing', async () => {
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
    vi.mocked(createDedicatedAccountForWallet).mockResolvedValue({
      success: true,
      data: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '2222222222',
        bankName: 'Test Bank',
        bankSlug: 'test-bank',
        currency: 'NGN',
        providerAccountId: '98',
        providerCustomerCode: 'CUS_existing',
        providerSubaccountCode: 'ACCT_merchant123',
      },
    });

    const accountQuery = createMaybeSingleQuery(null);
    const orderAliasQuery = createSelectRowsQuery([]);
    const { query: insertQuery } = createInsertQuery({
      ...existingAccountRow,
      account_number: '2222222222',
      provider_customer_code: 'CUS_existing',
    });
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(accountQuery)
        .mockReturnValueOnce(orderAliasQuery)
        .mockReturnValueOnce(insertQuery),
    } as unknown as SupabaseClient;

    await ensureCustomerWalletPaymentAccount({
      consentedAt: new Date('2026-05-21T10:00:00.000Z'),
      customer: { ...customer, first_name: null, last_name: null },
      merchant,
      supabase,
    });

    expect(createDedicatedAccountForWallet).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' })
    );
  });

  it('fails before the provider DVA request when no customer names are available', async () => {
    vi.mocked(createOrGetCustomer).mockResolvedValue({
      success: true,
      data: {
        customer_code: 'CUS_missing_names',
        email: 'jane@example.com',
        first_name: null,
        id: 100,
        last_name: null,
        phone: '+2348012345678',
      },
    });

    const accountQuery = createMaybeSingleQuery(null);
    const supabase = {
      from: vi.fn().mockReturnValue(accountQuery),
    } as unknown as SupabaseClient;

    await expect(
      ensureCustomerWalletPaymentAccount({
        consentedAt: new Date('2026-05-21T10:00:00.000Z'),
        customer: { ...customer, first_name: '  ', last_name: null },
        merchant,
        supabase,
      })
    ).rejects.toMatchObject({
      code: 'CUSTOMER_NAME_REQUIRED',
    });

    expect(createOrGetCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: undefined, last_name: undefined })
    );
    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
  });
});
