import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

export const wedgedCandidate = {
  amount: '58290.60',
  created_at: '2026-07-01T00:00:00.000Z',
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: '100004260711172450165090811595',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: null,
  order_id: 'order-1',
  orders: { cancelled_at: null, id: 'order-1', payment_status: 'pending' },
  status: 'completed',
};

export function buildSupabase(result: { data?: unknown[]; error?: unknown }) {
  const stampUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const builder: Record<string, unknown> = {
    update: stampUpdate,
  };
  const select = vi.fn().mockReturnValue(builder);
  builder.select = select;
  for (const method of ['eq', 'neq', 'not', 'lt', 'is', 'or', 'order']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  // `.limit()` is the terminal call in the sweep's candidate query chain;
  // resolution stamps go through `.update().eq()` on the same builder.
  builder.limit = vi
    .fn()
    .mockResolvedValue({ data: null, error: null, ...result });
  return {
    from: vi.fn().mockReturnValue(builder),
    select,
    stampUpdate,
  } as unknown as SupabaseClient & {
    select: ReturnType<typeof vi.fn>;
    stampUpdate: ReturnType<typeof vi.fn>;
  };
}

export const scheduleAfter = (task: () => Promise<void>) => {
  void task();
};
