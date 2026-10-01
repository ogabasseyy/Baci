import { vi } from 'vitest';

export const baseAccountRow = {
  order_id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
  assigned_at: '2026-05-09T10:00:00Z',
  created_at: '2026-05-09T10:00:00Z',
  expires_at: '2026-05-09T11:30:00Z',
  orders: {
    amount_paid: '0',
    id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
    merchant_id: 'merchant-1',
    customer_email: 'customer@example.com',
    total: '835000',
    updated_at: '2026-05-09T09:55:00Z',
    currency: 'NGN',
    payment_status: 'pending',
    recorded_by_user_id: null,
    shipping_status: 'pending',
  },
};

export const ctxBase = {
  accountNumber: '9812851228',
  gatewayReference: '100026260509110323000058369193',
  verifiedAmount: { amount: 835_000, currency: 'NGN' },
  paystackResponse: {
    customer: { email: 'customer@example.com' },
    paid_at: '2026-05-09T10:30:00Z',
  } as Record<string, unknown>,
};

export function createSupabaseMock(opts: {
  accountRows?: unknown[];
  accountLookupError?: unknown;
  insertResult?: { data: unknown; error: unknown };
  reuseLookupResult?: { data: unknown; error: unknown };
  reviewError?: unknown;
}) {
  const state = {
    accountLookupCalls: 0,
    insertCalls: [] as Record<string, unknown>[],
    reviewUpserts: [] as Record<string, unknown>[],
    reuseLookups: 0,
  };
  const rows = opts.accountRows ?? [baseAccountRow];
  const supabase = {
    from(table: string) {
      if (table === 'order_payment_accounts') {
        state.accountLookupCalls++;
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: opts.accountLookupError ? null : rows,
              error: opts.accountLookupError ?? null,
            }),
          }),
        };
      }
      if (table === 'transactions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(() => {
              state.reuseLookups++;
              const row = state.insertCalls.at(-1);
              return Promise.resolve(
                opts.reuseLookupResult ?? {
                  data: row ? { id: 'txn-new', ...row } : null,
                  error: null,
                }
              );
            }),
          }),
        };
      }
      if (table === 'reconciliation_review') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            state.reviewUpserts.push(row);
            return Promise.resolve({
              data: null,
              error: opts.reviewError ?? null,
            });
          }),
        };
      }
      throw new Error(`unmocked table: ${table}`);
    },
  };
  const rpc = vi.fn((name: string, params: Record<string, unknown>) => {
    if (name !== 'create_payment_transaction') {
      return Promise.resolve({ data: null, error: null });
    }
    const reserveRow = {
      amount: String(params.p_amount),
      currency: params.p_currency,
      gateway: params.p_gateway,
      gateway_reference: params.p_reference,
      merchant_amount: params.p_merchant_amount,
      merchant_id: params.p_merchant_id,
      metadata: params.p_metadata,
      order_id: params.p_order_id,
      platform_fee: params.p_platform_fee,
      status: 'pending',
      transaction_type: 'payment',
    };
    state.insertCalls.push(reserveRow);
    if (opts.insertResult?.error) {
      return Promise.resolve({ data: null, error: opts.insertResult.error });
    }
    const resultData = opts.insertResult?.data as { id?: unknown } | undefined;
    return Promise.resolve({
      data: typeof resultData?.id === 'string' ? resultData.id : 'txn-new',
      error: null,
    });
  });
  return { supabase: { ...supabase, rpc }, state };
}
