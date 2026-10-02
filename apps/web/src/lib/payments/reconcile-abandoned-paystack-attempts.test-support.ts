import { vi } from 'vitest';

export const candidate = {
  amount: 100,
  currency: 'NGN',
  id: 'attempt-1',
  order_id: 'order-1',
  merchant_id: 'merchant-1',
  gateway: 'paystack',
  gateway_reference: 'BAC-OLD' as string | null,
  metadata: {},
  paid_order: { payment_status: 'paid' },
  platform_fee: null as number | null,
  status: 'pending',
};

export const CANDIDATE_RPC = 'select_abandoned_paystack_attempt_candidates_v1';

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
    is: vi.fn().mockReturnThis(),
    select: selectUpdated,
  };
  const update = vi.fn(() => updateBuilder);
  // Candidate selection is a single RPC returning the stale main
  // branch plus the filing-only retry branch. Other RPCs (stamps,
  // merges) default to success; tests needing specific values
  // override via mockResolvedValueOnce sequencing or Object.assign
  // with a name-aware mock.
  const candidateRpc = vi.fn((fn: string) => {
    if (fn === CANDIDATE_RPC) {
      return Promise.resolve({ data: [...rows, ...pendingRows], error: null });
    }
    return Promise.resolve({ data: true, error: null });
  });
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
      if (table === 'transactions' && columns === 'id') {
        return completedLookup;
      }
      return transactionSelects++ % 2 === 0 ? orderLookup : completedLookup;
    }),
    update,
  }));
  return {
    client: { from, rpc: candidateRpc },
    candidateRpc,
    orderLookup,
    completedLookup,
    update,
    updateBuilder,
    selectUpdated,
  };
}
