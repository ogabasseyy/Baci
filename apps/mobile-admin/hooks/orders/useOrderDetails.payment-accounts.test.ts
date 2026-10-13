import { beforeEach, describe, expect, it } from 'vitest';
import {
  fetchOrderByIdForTest as fetchOrderById,
  orderDetailsTestMocks,
  resetOrderDetailsMocks,
  useOrderForTest as useOrder,
} from './useOrderDetails.test-support';

const { queryMock, supabaseMock } = orderDetailsTestMocks;

describe('fetchOrderById payment accounts and status', () => {
  beforeEach(resetOrderDetailsMocks);

  it('selects Paystack deterministically when legacy account rows coexist', async () => {
    supabaseMock.setTableResult('order_payment_accounts', {
      data: [
        {
          account_name: 'Legacy Store',
          account_number: '0987654321',
          bank_name: 'Kora Bank',
          provider: 'korapay',
          created_at: '2026-08-24T12:00:00.000Z',
        },
        {
          account_name: 'Baci Store',
          account_number: '1234567890',
          bank_name: 'Paystack-Titan',
          provider: 'paystack',
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        virtual_account: expect.objectContaining({
          account_number: '1234567890',
          provider: 'paystack',
        }),
      })
    );
  });

  it('uses the paid transaction receiver when historical Paystack aliases coexist', async () => {
    supabaseMock.setOrderDetailResult({
      data: {
        id: 'order-1',
        payment_status: 'paid',
        recorded_by_user_id: null,
        total: 1000,
        wallet_amount_used: 0,
      },
      error: null,
    });
    supabaseMock.setTableResult('transactions', {
      data: [
        {
          amount: 1000,
          created_at: '2026-08-24T13:30:00.000Z',
          gateway: 'paystack',
          metadata: { dva_account_number: '1111111111' },
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    supabaseMock.setTableResult('order_payment_accounts', {
      data: [
        {
          account_name: 'Paid DVA',
          account_number: '1111111111',
          assigned_at: '2026-08-24T12:00:00.000Z',
          bank_name: 'Paystack-Titan',
          created_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T13:00:00.000Z',
          provider: 'paystack',
        },
        {
          account_name: 'Newer DVA',
          account_number: '2222222222',
          assigned_at: '2026-08-24T12:30:00.000Z',
          bank_name: 'Paystack-Titan',
          created_at: '2026-08-24T12:30:00.000Z',
          expires_at: '2026-08-24T13:30:00.000Z',
          provider: 'paystack',
        },
      ],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        virtual_account: expect.objectContaining({
          account_number: '1111111111',
        }),
      })
    );
  });

  it('treats paid orders without ledger rows as fully paid', async () => {
    supabaseMock.setOrderDetailResult({
      data: {
        amount_paid: 0,
        id: 'order-1',
        payment_status: 'paid',
        recorded_by_user_id: null,
        total: 406_000,
        wallet_amount_used: 0,
      },
      error: null,
    });
    supabaseMock.setTableResult('transactions', {
      data: [],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        amount_paid: 406_000,
        balance: 0,
      })
    );
  });

  it('treats a stale partially-paid order as paid when its ledger covers the total', async () => {
    supabaseMock.setOrderDetailResult({
      data: {
        amount_paid: 900_000,
        id: 'order-1',
        payment_status: 'partially_paid',
        recorded_by_user_id: null,
        total: 982_000,
        wallet_amount_used: 0,
      },
      error: null,
    });
    supabaseMock.setTableResult('transactions', {
      data: [
        { amount: 654_000, transaction_type: 'payment' },
        { amount: 82_000, transaction_type: 'payment' },
        { amount: 82_000, transaction_type: 'payment' },
        { amount: 82_000, transaction_type: 'payment' },
        { amount: 82_000, transaction_type: 'payment' },
      ],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        amount_paid: 982_000,
        balance: 0,
        payment_status: 'paid',
      })
    );
  });

  it('does not promote a cancelled order when reconciliation payments cover the total', async () => {
    supabaseMock.setOrderDetailResult({
      data: {
        amount_paid: 0,
        cancelled_at: '2026-07-12T09:00:00Z',
        id: 'order-1',
        payment_status: 'unpaid',
        recorded_by_user_id: null,
        shipping_status: 'pending',
        total: 500,
        wallet_amount_used: 0,
      },
      error: null,
    });
    supabaseMock.setTableResult('transactions', {
      data: [{ amount: 500, transaction_type: 'payment' }],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        amount_paid: 500,
        balance: 0,
        payment_status: 'unpaid',
      })
    );
  });

  it('excludes refund rows when deriving effective payment status', async () => {
    supabaseMock.setOrderDetailResult({
      data: {
        amount_paid: 400,
        id: 'order-1',
        payment_status: 'partially_paid',
        recorded_by_user_id: null,
        total: 800,
        wallet_amount_used: 0,
      },
      error: null,
    });
    supabaseMock.setTableResult('transactions', {
      data: [
        { amount: 400, transaction_type: 'payment' },
        { amount: 400, transaction_type: 'refund' },
      ],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        amount_paid: 400,
        balance: 400,
        payment_status: 'partially_paid',
      })
    );
  });

  it('preserves refunded status when historical payments cover the total', async () => {
    supabaseMock.setOrderDetailResult({
      data: {
        amount_paid: 800,
        id: 'order-1',
        payment_status: 'refunded',
        recorded_by_user_id: null,
        total: 800,
        wallet_amount_used: 0,
      },
      error: null,
    });
    supabaseMock.setTableResult('transactions', {
      data: [{ amount: 800, transaction_type: 'payment' }],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        amount_paid: 800,
        balance: 0,
        payment_status: 'refunded',
      })
    );
  });

  it('throws order query errors before running child queries', async () => {
    supabaseMock.setOrderDetailResult({
      data: null,
      error: { message: 'Order unavailable' },
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).rejects.toThrow(
      'Order unavailable'
    );
    expect(supabaseMock.chains.map((chain) => chain.table)).toEqual(['orders']);
  });

  it('throws child query errors from the parallel detail fetch', async () => {
    supabaseMock.setTableResult('order_items', {
      data: [],
      error: { message: 'Items unavailable' },
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).rejects.toThrow(
      'Items unavailable'
    );
  });

  it('configures useOrder with merchant and branch-scope cache keys', async () => {
    const query = useOrder('order-1') as unknown as {
      enabled: boolean;
      queryFn: () => Promise<unknown>;
      queryKey: unknown[];
    };

    expect(queryMock.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        queryKey: ['order', 'order-1', 'merchant-1', 'all'],
        staleTime: 60000,
      })
    );

    await query.queryFn();

    const orderQuery = supabaseMock.chains.find(
      (chain) => chain.table === 'orders'
    );

    expect(orderQuery?.calls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['id', 'order-1'] },
        { method: 'eq', args: ['merchant_id', 'merchant-1'] },
      ])
    );
  });
});
