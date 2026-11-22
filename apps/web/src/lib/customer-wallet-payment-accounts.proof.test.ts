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

function providerAccount(splitConfig: unknown, customerCode = 'CUS_existing') {
  return {
    account_name: 'Ogabassey/Jane Doe',
    account_number: '3333333333',
    active: true,
    assigned: true,
    bank: { id: 1, name: 'Titan Paystack', slug: 'titan-paystack' },
    created_at: '2026-05-21T09:00:00.000Z',
    currency: 'NGN',
    customer: {
      customer_code: customerCode,
      email: 'jane@example.com',
      first_name: 'Jane',
      id: 100,
      last_name: 'Doe',
    },
    id: 99,
    metadata: null,
    split_config: splitConfig,
    updated_at: '2026-05-21T09:00:00.000Z',
  };
}

describe('customer wallet payment account provider proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDedicatedAccounts).mockResolvedValue({
      success: true,
      data: [],
    });
  });

  it.each([
    ['object', { subaccount: 'ACCT_merchant123' }],
    ['stringified', '{"subaccount":"ACCT_merchant123"}'],
  ])('persists a provider DVA only with %s subaccount proof', async (_label, splitConfig) => {
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
      data: [providerAccount(splitConfig) as never],
    });

    const walletDvaWriter = createWalletDvaTestWriter();
    const supabase = {
      from: vi.fn(() => createMaybeSingleQuery(null)),
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
        accountNumber: '3333333333',
        providerSubaccountCode: 'ACCT_merchant123',
      })
    );

    expect(createDedicatedAccountForWallet).not.toHaveBeenCalled();
    expect(walletDvaWriter).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '3333333333',
        providerCustomerCode: 'CUS_existing',
        providerSubaccountCode: 'ACCT_merchant123',
        userId: customer.user_id,
      })
    );
  });

  it('does not accept an existing provider account associated with another customer', async () => {
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
        providerAccount(
          { subaccount: 'ACCT_merchant123' },
          'CUS_other'
        ) as never,
      ],
    });
    vi.mocked(createDedicatedAccountForWallet).mockResolvedValue({
      success: false,
      error: 'Paystack did not return proof for the requested customer',
      code: 'VALIDATION_ERROR',
    });

    const walletDvaWriter = createWalletDvaTestWriter();
    const supabase = {
      from: vi.fn(() => createMaybeSingleQuery(null)),
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
    ).rejects.toMatchObject({ code: 'PAYSTACK_DVA_ERROR' });
    expect(walletDvaWriter).not.toHaveBeenCalled();
  });

  it('normalizes an empty provider bank slug to null before restricted persistence', async () => {
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
          ...providerAccount({ subaccount: 'ACCT_merchant123' }),
          bank: { id: 1, name: 'Titan Paystack', slug: '   ' },
        } as never,
      ],
    });

    const walletDvaWriter = createWalletDvaTestWriter();
    const supabase = {
      from: vi.fn(() => createMaybeSingleQuery(null)),
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
    ).resolves.toMatchObject({ bankSlug: null });

    expect(walletDvaWriter).toHaveBeenCalledWith(
      expect.objectContaining({ bankSlug: null })
    );
  });
});
