import { vi } from 'vitest';

export const candidate = {
  amount: 100,
  currency: 'NGN',
  id: 'attempt-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway: 'paystack',
  gateway_reference: 'BAC-OLD',
  metadata: {},
  paid_order: { payment_status: 'paid' },
  platform_fee: null as number | null,
  status: 'pending',
};

const CANDIDATE_COLUMNS =
  'id, order_id, merchant_id, gateway, gateway_reference, amount, currency, status, metadata, platform_fee, paid_order:orders!transactions_order_id_fkey!inner(payment_status)';

export function createClient(
  rows = [candidate],
  { paid = true, completed = true, dvaSibling = false } = {},
  pendingRows: unknown[] = []
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
  const lookupEqCalls: unknown[][] = [];
  let lookupEqSeen = 0;
  const lookup = {
    eq: vi.fn((...args: unknown[]) => {
      lookupEqCalls.push(args);
      return lookup;
    }),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    // The sweep runs two candidate queries (main, then filing-only
    // retries): route by the retry marker filter so each resolves its
    // own canned rows.
    limit: vi.fn(() => {
      const queryEqCalls = lookupEqCalls.slice(lookupEqSeen);
      lookupEqSeen = lookupEqCalls.length;
      const isPendingRetry = queryEqCalls.some(
        ([column]) => column === 'metadata->>duplicate_capture_review_pending'
      );
      return { data: isPendingRetry ? pendingRows : rows, error: null };
    }),
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
    in: vi.fn().mockReturnThis(),
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
    select: vi.fn((columns: string) => {
      if (table === 'orders') return orderLookup;
      // Candidate queries always resolve the attempt rows and the
      // completed-payment probe always resolves its own canned rows;
      // anything else keeps the legacy alternation.
      if (table === 'transactions' && columns === CANDIDATE_COLUMNS) {
        return lookup;
      }
      if (table === 'transactions' && columns === 'id') {
        return completedLookup;
      }
      return transactionSelects++ % 2 === 0 ? lookup : completedLookup;
    }),
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
