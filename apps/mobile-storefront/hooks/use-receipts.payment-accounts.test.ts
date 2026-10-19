import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

type SupabaseMockResult = Promise<{ data: unknown; error: unknown }>;

const mockOrderEq = jest.fn();
const mockOrderSingle = jest.fn<() => SupabaseMockResult>();
const mockPaymentAccountsRpc = jest.fn<() => SupabaseMockResult>();
const mockTransactionsRpc = jest.fn<() => SupabaseMockResult>();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_SLUG: 'ogabassey' } }));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn() }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (fn === 'get_customer_order_payment_accounts') {
        return mockPaymentAccountsRpc();
      }
      return mockTransactionsRpc();
    },
    from: (table: string) => ({
      select: () => {
        if (table === 'orders') return { eq: mockOrderEq };
        return { eq: jest.fn() };
      },
    }),
  },
}));

import { receiptDetailQueryOptions } from './use-receipts';

const baseOrder = {
  amount_paid: 0,
  created_at: '2026-07-08T12:33:00.000Z',
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  customer_phone: null,
  discount_amount: 0,
  id: 'order-1',
  is_credit_order: false,
  notes: null,
  order_items: [],
  order_number: 'ORD-1',
  payment_method: 'paystack',
  payment_status: 'pending',
  shipping_address: null,
  shipping_fee: 0,
  subtotal: 690000,
  tax_amount: 0,
  total: 690000,
};

function queryDetail() {
  return receiptDetailQueryOptions('order-1', {
    merchantId: 'merchant-1',
    userId: 'user-1',
  }).queryFn();
}

describe('receipt payment-account history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockOrderSingle.mockResolvedValue({ data: baseOrder, error: null });
    mockOrderEq.mockImplementation(() => ({
      eq: mockOrderEq,
      single: mockOrderSingle,
    }));
    mockPaymentAccountsRpc.mockResolvedValue({ data: [], error: null });
    mockTransactionsRpc.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('selects the Paystack account when legacy provider rows coexist', async () => {
    jest.setSystemTime(new Date('2026-07-08T12:15:00.000Z'));
    mockPaymentAccountsRpc.mockResolvedValueOnce({
      data: [
        {
          account_name: 'Legacy account',
          account_number: '1111111111',
          bank_name: 'Korapay',
          created_at: '2026-07-08T12:00:00.000Z',
          provider: 'korapay',
        },
        {
          account_name: 'Automatic confirmation',
          account_number: '2222222222',
          bank_name: 'Paystack',
          created_at: '2026-07-08T12:10:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });

    const detail = await queryDetail();

    expect(detail.virtual_account).toEqual(
      expect.objectContaining({
        account_number: '2222222222',
        provider: 'paystack',
      })
    );
  });

  it('selects a legacy account when the Paystack alias has expired', async () => {
    jest.setSystemTime(new Date('2026-07-08T13:00:00.000Z'));
    mockPaymentAccountsRpc.mockResolvedValueOnce({
      data: [
        {
          account_name: 'Legacy account',
          account_number: '1111111111',
          bank_name: 'Korapay',
          created_at: '2026-07-08T12:00:00.000Z',
          provider: 'korapay',
        },
        {
          account_name: 'Expired automatic confirmation',
          account_number: '2222222222',
          assigned_at: '2026-07-08T11:00:00.000Z',
          bank_name: 'Paystack',
          expires_at: '2026-07-08T12:30:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });

    const detail = await queryDetail();

    expect(detail.virtual_account?.account_number).toBe('1111111111');
  });

  it('keeps an expired Paystack account on a paid receipt', async () => {
    jest.setSystemTime(new Date('2026-07-08T13:00:00.000Z'));
    mockOrderSingle.mockResolvedValueOnce({
      data: { ...baseOrder, amount_paid: 690000, payment_status: 'paid' },
      error: null,
    });
    mockPaymentAccountsRpc.mockResolvedValueOnce({
      data: [
        {
          account_name: 'Expired automatic confirmation',
          account_number: '2222222222',
          assigned_at: '2026-07-08T11:00:00.000Z',
          bank_name: 'Paystack',
          expires_at: '2026-07-08T12:30:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });

    const detail = await queryDetail();

    expect(detail.virtual_account).toEqual(
      expect.objectContaining({
        account_number: '2222222222',
        provider: 'paystack',
      })
    );
  });
});
