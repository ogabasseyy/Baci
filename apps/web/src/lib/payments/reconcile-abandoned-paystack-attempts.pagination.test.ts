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
    gateway_reference: `BAC-${index}`,
    amount: 100,
    currency: 'NGN',
    status: 'pending',
    metadata: {},
    createdAt: firstRun - 13 * 60 * 60_000,
    updatedAt: firstRun - 13 * 60 * 60_000 + index,
  }));
  const cutoffs = new Map<string, number>();
  const candidates = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    lt: vi.fn((field: string, value: string) => {
      cutoffs.set(field, Date.parse(value));
      return candidates;
    }),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn((limit: number) =>
      Promise.resolve({
        data: rows
          .filter(
            (row) =>
              row.createdAt < (cutoffs.get('created_at') ?? 0) &&
              row.updatedAt < (cutoffs.get('updated_at') ?? 0)
          )
          .sort((left, right) => left.updatedAt - right.updatedAt)
          .slice(0, limit),
        error: null,
      })
    ),
  };
  const completed = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
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
    select: (columns: string) =>
      table === 'orders'
        ? order
        : columns.includes('paid_order:')
          ? candidates
          : completed,
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
    supabase: { from } as never,
    verify,
  });
  vi.setSystemTime(firstRun + 60 * 60_000);
  const second = await reconcileAbandonedPaystackAttempts({
    supabase: { from } as never,
    verify,
  });

  expect(first.checked).toBe(25);
  expect(second.held[0]?.id).toBe('attempt-25');
});
