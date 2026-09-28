import { vi } from 'vitest';

export function database(
  eventType: string,
  paymentStatus = 'refunded',
  ledger: {
    payments?: Array<{
      amount: number;
      currency?: string;
      gateway: string;
      id: string;
      status?: string;
    }>;
    refunds?: Array<{
      amount: number;
      currency: string;
      gateway: string;
      metadata: { payment_transaction_id?: string };
    }>;
  } = {}
) {
  const order = {
    id: 'order-1',
    merchant_id: 'merchant-1',
    order_number: 'ORD-1',
    customer_email: 'buyer@example.com',
    customer_name: '<Buyer>',
    customer_id: 'customer-1',
    amount_paid: 100,
    currency: 'NGN',
    payment_status: paymentStatus,
    cancelled_at: '2026-09-27T00:00:00Z',
  };
  const merchant = {
    id: 'merchant-1',
    business_name: 'Shop',
    email: 'merchant@example.com',
    support_email: 'help@example.com',
    email_sender_name: null,
  };
  const row = {
    id: 'notification-1',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    event_type: eventType,
    claim_token: 'claim-1',
  };
  const finish = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id: row.id }, error: null }),
  };
  const orderQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: order, error: null }),
  };
  const merchantQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: merchant, error: null }),
  };
  const payments = ledger.payments ?? [
    { amount: 60, gateway: 'paystack', id: 'payment-1' },
  ];
  const refunds = ledger.refunds ?? [
    {
      amount: 60,
      currency: 'NGN',
      gateway: 'paystack',
      metadata: { payment_transaction_id: 'payment-1' },
    },
  ];
  const ledgerQuery = () => {
    let mode: 'payments' | 'refunds' = 'refunds';
    let statusFilter: readonly unknown[] | null = null;
    const resolveLedger = () =>
      Promise.resolve({
        data:
          mode === 'payments'
            ? payments
                .map((payment) => ({
                  currency: 'NGN',
                  status: 'completed',
                  ...payment,
                }))
                .filter(
                  (payment) =>
                    statusFilter === null ||
                    statusFilter.includes(payment.status)
                )
            : refunds,
        error: null,
      });
    const query = {
      eq: vi.fn((column: string) =>
        column === 'status' ? resolveLedger() : query
      ),
      in: vi.fn((column: string, values?: readonly unknown[]) => {
        if (column !== 'status') return query;
        statusFilter = values ?? null;
        return resolveLedger();
      }),
      select: vi.fn((columns: string) => {
        mode = columns.includes('metadata') ? 'refunds' : 'payments';
        return query;
      }),
    };
    return query;
  };
  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return orderQuery;
      if (table === 'merchants') return merchantQuery;
      if (table === 'transactions') return ledgerQuery();
      return finish;
    }),
    rpc: vi
      .fn()
      .mockResolvedValue({ data: [], error: null })
      .mockResolvedValueOnce({ data: [row], error: null }),
    finish,
  };
}
