import { afterEach, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';

afterEach(() => vi.useRealTimers());

it('checks the next stale attempt before rechecking 25 held attempts on the next run', async () => {
  vi.useFakeTimers();
  const firstRun = Date.parse('2026-09-27T12:00:00.000Z');
  vi.setSystemTime(firstRun);
  const rows = Array.from({ length: 26 }, (_, index) => ({
    id: `attempt-${index}`,
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    gateway: 'paystack',
    gateway_reference: `BAC-${index}`,
    amount: 100,
    currency: 'NGN',
    status: 'pending',
    metadata: {},
    createdAt: firstRun - 13 * 60 * 60_000,
    updatedAt: firstRun - 13 * 60 * 60_000 + index,
  }));
  const rpc = vi.fn(
    (
      fn: string,
      args: {
        p_limit: number;
        p_or_cutoff: string;
        p_or_recheck_cutoff: string;
      }
    ) => {
      // Simulate the candidate RPC: cutoff filters, oldest-first
      // order, per-branch limit.
      if (fn !== 'select_abandoned_paystack_attempt_candidates_v1') {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({
        data: rows
          .filter(
            (row) =>
              row.createdAt < Date.parse(args.p_or_cutoff) &&
              row.updatedAt < Date.parse(args.p_or_recheck_cutoff)
          )
          .sort((left, right) => left.updatedAt - right.updatedAt)
          .slice(0, args.p_limit),
        error: null,
      });
    }
  );
  const completed = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [{ id: 'paid-attempt' }],
      error: null,
    }),
  };
  const order = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: 'order-1' },
      error: null,
    }),
  };
  const from = vi.fn((table: string) => ({
    select: () => (table === 'orders' ? order : completed),
    update: (payload: { updated_at: string }) => {
      let targetId = '';
      return {
        eq(field: string, value: string) {
          if (field === 'id') targetId = value;
          return this;
        },
        // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
        then(resolve: (result: { error: null }) => void) {
          const target = rows.find((row) => row.id === targetId);
          if (target) target.updatedAt = Date.parse(payload.updated_at);
          resolve({ error: null });
        },
      };
    },
  }));
  const verify = vi.fn().mockResolvedValue({
    success: true,
    data: { status: 'pending', amount: 10000, currency: 'NGN' },
  });

  const first = await reconcileAbandonedPaystackAttempts({
    supabase: { from, rpc } as never,
    verify,
  });
  vi.setSystemTime(firstRun + 60 * 60_000);
  const second = await reconcileAbandonedPaystackAttempts({
    supabase: { from, rpc } as never,
    verify,
  });

  expect(first.checked).toBe(25);
  expect(second.held[0]?.id).toBe('attempt-25');
});
