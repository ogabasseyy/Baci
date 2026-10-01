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

export function buildSupabase(
  result: { data?: unknown[]; error?: unknown },
  pendingResult: { data?: unknown[]; error?: unknown } = { data: [] }
) {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const builder: Record<string, unknown> = {};
  const select = vi.fn().mockReturnValue(builder);
  builder.select = select;
  const eqCalls: unknown[][] = [];
  let eqCallsSeen = 0;
  for (const method of ['neq', 'not', 'lt', 'is', 'or', 'order']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.eq = vi.fn((...args: unknown[]) => {
    eqCalls.push(args);
    return builder;
  });
  // `.limit()` is the terminal call in the sweep's candidate query chain;
  // resolution stamps go through the atomic stamp RPC. The sweep runs
  // two candidate queries (main, then filing-only retries): route by the
  // retry marker filter so each run resolves its own canned rows no
  // matter how many sweeps a test performs.
  builder.limit = vi.fn(() => {
    const queryEqCalls = eqCalls.slice(eqCallsSeen);
    eqCallsSeen = eqCalls.length;
    const isPendingRetry = queryEqCalls.some(
      ([column]) => column === 'metadata->>duplicate_capture_review_pending'
    );
    return {
      data: null,
      error: null,
      ...(isPendingRetry ? pendingResult : result),
    };
  });
  return {
    from: vi.fn().mockReturnValue(builder),
    rpc,
    select,
  } as unknown as SupabaseClient & {
    rpc: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
}

export const scheduleAfter = (task: () => Promise<void>) => {
  void task();
};
