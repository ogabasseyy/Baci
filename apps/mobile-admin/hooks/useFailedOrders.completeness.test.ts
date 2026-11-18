import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLLOW_UP_QUERY_LIMIT } from '@/config/follow-up-queue';
import type { FakeOrderRow } from '../test/mocks/supabase-order-query-fake';
import { matchesOrFilter } from '../test/postgrest-filter';
import type { FailedOrder } from './useFailedOrders';

type SourcePayload = { orders: FailedOrder[]; isLimited: boolean };

const holder = vi.hoisted(() => ({
  fake: null as ReturnType<
    typeof import('../test/mocks/supabase-order-query-fake').createSupabaseOrderQueryFake
  > | null,
  queryFn: undefined as (() => Promise<SourcePayload>) | undefined,
  queryKey: [] as readonly unknown[],
  cachedData: undefined as
    | { orders: FailedOrder[]; isLimited: boolean }
    | undefined,
}));
vi.mock('@/lib/supabase', async () => {
  const { createSupabaseOrderQueryFake } = await import(
    '../test/mocks/supabase-order-query-fake'
  );
  holder.fake = createSupabaseOrderQueryFake([]);
  return { supabase: { from: () => holder.fake?.from() } };
});
vi.mock('./useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(
    (config: {
      queryFn: () => Promise<SourcePayload>;
      queryKey: readonly unknown[];
    }) => {
      holder.queryFn = config.queryFn;
      holder.queryKey = config.queryKey;
      return { data: holder.cachedData };
    }
  ),
}));

import { useFailedOrders } from './useFailedOrders';

const row: FakeOrderRow = {
  created_at: '2026-06-01T01:00:00Z',
  customer_email: 'ada@example.com',
  customer_id: 'customer-1',
  customer_name: 'Ada',
  customer_phone: '08031234567',
  id: 'order-1',
  order_number: 'ORD-1',
  payment_method: 'card',
  payment_status: 'failed',
  total: 10000,
  transactions: [],
};
function fake() {
  if (!holder.fake) throw new Error('Missing query fake');
  return holder.fake;
}
async function runResult() {
  // biome-ignore lint/correctness/useHookAtTopLevel: useQuery returns its config in this harness
  useFailedOrders();
  if (!holder.queryFn) throw new Error('Missing captured query');
  return holder.queryFn();
}

describe('standard follow-up coverage and completeness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T02:00:00Z'));
    holder.cachedData = undefined;
    fake().reset([]);
  });
  it('keeps the standard budget independent from Oxygen failures', async () => {
    fake().setRows([row]);
    expect((await runResult()).orders).toHaveLength(1);
    const filter = String(
      fake().calls.find((call) => call.method === 'or')?.args[0]
    );
    for (const payment_status of ['failed', 'expired']) {
      expect(
        matchesOrFilter({ payment_method: 'oxygen', payment_status }, filter)
      ).toBe(false);
      expect(
        matchesOrFilter({ payment_method: 'card', payment_status }, filter)
      ).toBe(true);
    }
  });
  it.each([
    'failed',
    'expired',
  ])('leaves %s Oxygen orders to their independent RPC budget', async (payment_status) => {
    await runResult();
    const filter = String(
      fake().calls.find((call) => call.method === 'or')?.args[0]
    );
    for (const provenance of [
      { recorded_by_user_id: 'staff', source: 'manual' },
      { external_source: 'import', import_job_id: 'job' },
    ]) {
      expect(
        matchesOrFilter(
          { ...provenance, payment_method: 'oxygen', payment_status },
          filter
        )
      ).toBe(false);
    }
  });
  it('does not re-admit Oxygen pending or in-progress rows to the fallback', async () => {
    fake().setRows(
      ['pending', 'unpaid', 'bnpl_pending'].map((payment_status) => ({
        ...row,
        payment_method: 'oxygen',
        payment_status,
      }))
    );
    expect((await runResult()).orders).toEqual([]);
    const filter = String(
      fake().calls.find((call) => call.method === 'or')?.args[0]
    );
    for (const payment_status of ['pending', 'unpaid']) {
      const checkout = {
        payment_status,
        created_at: row.created_at,
        source: 'online_store',
        recorded_by_user_id: null,
        external_source: null,
        import_job_id: null,
      };
      expect(
        matchesOrFilter({ ...checkout, payment_method: 'oxygen' }, filter)
      ).toBe(false);
      expect(
        matchesOrFilter({ ...checkout, payment_method: 'paystack' }, filter)
      ).toBe(true);
    }
  });
  it('consolidates case variants without changing the displayed latest email', async () => {
    fake().setRows([
      {
        ...row,
        id: 'newer',
        customer_email: ' Ada@Example.com ',
        created_at: '2026-06-01T02:00:00Z',
      },
      {
        ...row,
        id: 'older',
        customer_email: 'ada@example.com',
        created_at: '2026-06-01T01:00:00Z',
      },
    ]);
    expect((await runResult()).orders).toEqual([
      expect.objectContaining({
        id: 'newer',
        customer_email: 'Ada@Example.com',
        attempt_count: 2,
      }),
    ]);
  });

  it('detects overflow before email consolidation and keeps the row cap', async () => {
    fake().setRows(
      Array.from({ length: FOLLOW_UP_QUERY_LIMIT + 1 }, (_, i) => ({
        ...row,
        id: `order-${i}`,
      }))
    );
    const result = await runResult();
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].attempt_count).toBe(FOLLOW_UP_QUERY_LIMIT);
    expect(result.isLimited).toBe(true);
  });
  it('does not report overflow for an exactly full source', async () => {
    fake().setRows(
      Array.from({ length: FOLLOW_UP_QUERY_LIMIT }, (_, i) => ({
        ...row,
        id: `order-${i}`,
        customer_email: `${i}@example.com`,
      }))
    );
    const result = await runResult();
    expect(result.orders).toHaveLength(FOLLOW_UP_QUERY_LIMIT);
    expect(result.isLimited).toBe(false);
  });
  it('preserves the public array and completeness flag with a versioned cache key', () => {
    holder.cachedData = { orders: [], isLimited: true };
    const query = useFailedOrders();
    expect(query.data).toEqual([]);
    expect(query).toHaveProperty('isLimited', true);
    expect(holder.queryKey).toEqual(['failed-orders', 'merchant-1', 'v2']);
  });
});
