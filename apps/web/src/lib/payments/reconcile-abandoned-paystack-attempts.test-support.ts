import { vi } from 'vitest';

export const candidate = {
  amount: 100,
  currency: 'NGN',
  id: 'attempt-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway_reference: 'BAC-OLD',
  metadata: {},
  paid_order: { payment_status: 'paid' },
  platform_fee: null as number | null,
  status: 'pending',
};

export function createClient(
  rows = [candidate],
  { paid = true, completed = true, dvaSibling = false } = {}
) {
  const selectUpdated = vi.fn().mockResolvedValue({
    data: [{ id: 'attempt-1' }],
    error: null,
  });
  const updateBuilder = {
    eq: vi.fn().mockReturnThis(),
    select: selectUpdated,
  };
  const update = vi.fn(() => updateBuilder);
  const lookup = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  const orderLookup = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: paid ? { id: 'order-1' } : null,
      error: null,
    }),
  };
  const completedLookup = {
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: completed
        ? [
            { id: 'paid-attempt', metadata: {} },
            ...(dvaSibling
              ? [
                  {
                    id: 'dva-paid-attempt',
                    metadata: { dva_lookup_path: 'order_payment_accounts' },
                  },
                ]
              : []),
          ]
        : [],
      error: null,
    }),
  };
  let transactionSelects = 0;
  const from = vi.fn((table: string) => ({
    select: vi.fn(() =>
      table === 'orders'
        ? orderLookup
        : transactionSelects++ % 2 === 0
          ? lookup
          : completedLookup
    ),
    update,
  }));
  return {
    client: { from },
    lookup,
    orderLookup,
    completedLookup,
    update,
    updateBuilder,
    selectUpdated,
  };
}
