import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const failedRow = {
  order_id: 'order-1',
  transaction_id: 'txn-1',
  transactions: {
    amount: '58290.60',
    created_at: '2026-07-01T00:00:00.000Z',
    gateway: 'paystack',
    gateway_reference: 'REF-1',
    gateway_response: { fees_split: null, status: 'success', subaccount: {} },
    id: 'txn-1',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
    platform_fee: 1165.81,
  },
  orders: { cancelled_at: null, id: 'order-1', payment_status: 'paid' },
};

function buildSupabase(result: { data?: unknown[]; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'is', 'lt', 'in']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.limit = vi
    .fn()
    .mockResolvedValue({ data: null, error: null, ...result });
  return {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient;
}

export const drainFailedPaidOrderSideEffectsTestKit = {
  buildSupabase,
  failedRow,
};
