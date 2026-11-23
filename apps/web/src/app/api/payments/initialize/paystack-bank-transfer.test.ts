import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCharge: vi.fn(),
  resolveSplit: vi.fn(),
  createSupabase: vi.fn(async () => ({})),
}));

vi.mock('@/lib/agentic/paystack', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/agentic/paystack')>();
  return {
    ...actual,
    createPaystackBankTransferCharge: mocks.createCharge,
  };
});
vi.mock('@/lib/payments/resolve-paystack-split-transaction-charge', () => ({
  resolvePaystackSplitTransactionCharge: mocks.resolveSplit,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createSupabase,
}));

import { initializePaystackBankTransfer } from './paystack-bank-transfer';

const baseInput = {
  isNigerianCustomer: true,
  merchantId: 'merchant-1',
  subaccountCode: 'ACCT_TESTMOCK1234567',
  reference: 'ref-bt-1',
  orderId: 'order-1',
  amount: 385000,
  customerEmail: 'ada@example.com',
  customerName: 'Ada Obi',
  customerPhone: '+2348012345678',
};

describe('initializePaystackBankTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-Nigerian customers with 400 without calling Paystack', async () => {
    const outcome = await initializePaystackBankTransfer({
      ...baseInput,
      isNigerianCustomer: false,
    });
    expect(outcome).toMatchObject({
      ok: false,
      status: 400,
      code: 'PAYMENT_METHOD_COUNTRY_UNSUPPORTED',
    });
    expect(mocks.createCharge).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the merchant subaccount is missing or malformed', async () => {
    for (const subaccountCode of [null, 'BAD_CODE']) {
      const outcome = await initializePaystackBankTransfer({
        ...baseInput,
        subaccountCode,
      });
      expect(outcome).toMatchObject({
        ok: false,
        status: 503,
        code: 'PAYSTACK_SUBACCOUNT_MISSING',
      });
    }
    expect(mocks.createCharge).not.toHaveBeenCalled();
  });

  it('resolves split shipping, initializes the bank transfer charge, and returns expiry', async () => {
    mocks.resolveSplit.mockResolvedValueOnce({
      transactionChargeKobo: 450000,
      retainedShippingKobo: 250000,
    });
    mocks.createCharge.mockResolvedValueOnce({
      bank_name: 'Test Bank',
      account_number: '9988776655',
      account_name: 'Ogabassey Checkout',
      account_expires_at: '2026-11-23T12:00:00Z',
      reference: 'ref-bt-1',
    });

    const outcome = await initializePaystackBankTransfer(baseInput);
    expect(outcome).toEqual({
      ok: true,
      paymentResult: {
        authorization_url: '',
        dva: {
          bank_name: 'Test Bank',
          account_number: '9988776655',
          account_name: 'Ogabassey Checkout',
          account_expires_at: '2026-11-23T12:00:00Z',
        },
        reference: 'ref-bt-1',
        platformFee: expect.any(Number),
        merchantAmount: expect.any(Number),
      },
    });
    expect(mocks.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ada@example.com',
        amountKobo: 38500000,
        subaccount: 'ACCT_TESTMOCK1234567',
        transactionChargeKobo: 450000,
      })
    );
  });
});
