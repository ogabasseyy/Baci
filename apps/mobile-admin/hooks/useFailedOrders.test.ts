import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeOrderRow } from '../test/mocks/supabase-order-query-fake';
import { matchesOrFilter } from '../test/postgrest-filter';

const DEFAULT_ROW: FakeOrderRow = {
  created_at: '2026-06-02T01:00:00.000Z',
  customer_email: 'ada@example.com',
  customer_id: null,
  customer_name: 'Ada Buyer',
  customer_phone: '+2348012345678',
  id: 'order-1',
  order_number: 'ORD-001',
  payment_method: 'paystack',
  payment_status: 'unpaid',
  total: 15000,
  transactions: [],
};

/** Holder so the hoisted mock factory can publish the fake back to the tests. */
const holder = vi.hoisted(() => ({
  fake: null as ReturnType<
    typeof import('../test/mocks/supabase-order-query-fake').createSupabaseOrderQueryFake
  > | null,
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
  useQuery: vi.fn((config) => config),
}));

import {
  FOLLOW_UP_QUERY_LIMIT,
  FOLLOW_UP_WINDOW_DAYS,
} from '@/config/follow-up-queue';
import { ONLINE_CHECKOUT_PAYMENT_METHODS } from './orders/order-list-visibility';
import { useFailedOrders } from './useFailedOrders';

const NOW = '2026-06-02T02:00:00.000Z';

function fake() {
  if (!holder.fake) {
    throw new Error('supabase fake was not initialised by the mock factory');
  }
  return holder.fake;
}

function makeRow(overrides: Partial<FakeOrderRow>): FakeOrderRow {
  return { ...DEFAULT_ROW, ...overrides };
}

function daysBefore(days: number): string {
  return new Date(new Date(NOW).getTime() - days * 86_400_000).toISOString();
}

async function runQuery(): Promise<
  Array<{
    attempt_count: number;
    customer_email: string;
    gateway?: string;
    payment_status: string;
  }>
> {
  // biome-ignore lint/correctness/useHookAtTopLevel: useQuery is mocked to return its config object, so this is a plain call — no React runtime, no hook order to preserve
  const query = useFailedOrders() as unknown as {
    queryFn: () => Promise<
      Array<{
        attempt_count: number;
        customer_email: string;
        gateway?: string;
        payment_status: string;
      }>
    >;
  };
  return query.queryFn();
}

describe('useFailedOrders', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    fake().reset([DEFAULT_ROW]);
  });

  it('routes stale unpaid online checkout initiations into customer follow-up', async () => {
    const result = await runQuery();

    expect(fake().calls).toEqual(
      expect.arrayContaining([
        {
          method: 'or',
          args: [
            `payment_status.in.(bnpl_pending,failed,expired),and(payment_status.eq.pending,created_at.lt.2026-06-02T01:30:00.000Z,payment_method.in.${ONLINE_CHECKOUT_PAYMENT_METHODS},recorded_by_user_id.is.null,source.in.(online_store,mobile_app,storefront,agentic_ai)),and(payment_status.eq.unpaid,created_at.lt.2026-06-02T01:30:00.000Z,payment_method.in.${ONLINE_CHECKOUT_PAYMENT_METHODS},recorded_by_user_id.is.null,source.in.(online_store,mobile_app,storefront,agentic_ai))`,
          ],
        },
      ])
    );
    expect(result).toEqual([
      expect.objectContaining({
        attempt_count: 1,
        customer_email: 'ada@example.com',
        payment_status: 'unpaid',
      }),
    ]);
  });

  describe('bugfix: ambiguous orders->transactions embed emptied the Follow Up tab', () => {
    it('names the order_id foreign key so PostgREST cannot reject the embed as ambiguous', async () => {
      await runQuery();

      const select = String(
        fake().calls.find((call) => call.method === 'select')?.args[0] ?? ''
      );
      expect(select).toContain('transactions!transactions_order_id_fkey');
      expect(select).not.toMatch(/(^|[^!\w])transactions\s*\(/);
    });

    it('keeps reading the embedded rows off the unhinted `transactions` key', async () => {
      fake().setRows([
        makeRow({
          payment_method: 'credit_direct',
          payment_status: 'bnpl_pending',
          transactions: [
            {
              gateway: 'credit_direct',
              gateway_response: { message: 'Declined by issuer' },
              status: 'failed',
            },
          ],
        }),
      ]);

      const result = await runQuery();

      expect(result[0]).toEqual(
        expect.objectContaining({ gateway: 'credit_direct' })
      );
    });
  });

  describe('bugfix: the follow-up queue was unbounded and grew forever', () => {
    it('excludes orders older than the follow-up window from the returned queue', async () => {
      // Arrange: one row inside the window, one well outside it.
      fake().setRows([
        makeRow({
          created_at: daysBefore(2),
          customer_email: 'recent@example.com',
          id: 'recent',
        }),
        makeRow({
          created_at: daysBefore(FOLLOW_UP_WINDOW_DAYS + 30),
          customer_email: 'ancient@example.com',
          id: 'ancient',
        }),
      ]);

      // Act
      const result = await runQuery();

      // Assert: on the returned rows, not on the builder calls.
      expect(result.map((r) => r.customer_email)).toEqual([
        'recent@example.com',
      ]);
    });

    it('keeps an order sitting just inside the window', async () => {
      // Arrange: guards against an off-by-one that would silently narrow it.
      fake().setRows([
        makeRow({
          created_at: daysBefore(FOLLOW_UP_WINDOW_DAYS - 1),
          customer_email: 'edge@example.com',
          id: 'edge',
        }),
      ]);

      const result = await runQuery();

      expect(result.map((r) => r.customer_email)).toEqual(['edge@example.com']);
    });

    it('returns no more customers than the fetch cap allows', async () => {
      // Arrange: one order each for more customers than the cap permits.
      fake().setRows(
        Array.from({ length: FOLLOW_UP_QUERY_LIMIT + 25 }, (_, i) =>
          makeRow({
            created_at: daysBefore(1 + i / 1000),
            customer_email: `c${i}@example.com`,
            id: `order-${i}`,
          })
        )
      );

      const result = await runQuery();

      expect(result).toHaveLength(FOLLOW_UP_QUERY_LIMIT);
    });

    it('drops the least recently active customers first when the cap truncates', async () => {
      // Arrange: the cap cuts the oldest rows because the query orders
      // created_at DESC, so truncation can never hide a fresher customer
      // behind a staler one.
      //
      // Every fixture must sit INSIDE the window, spread by fractions of a
      // day. Spreading by whole days would let `.gte()` cut the set below
      // the cap first, and the test would then pass without `.limit()` or
      // the ordering ever being exercised.
      fake().setRows(
        Array.from({ length: FOLLOW_UP_QUERY_LIMIT + 5 }, (_, i) =>
          makeRow({
            created_at: daysBefore(1 + i / 100),
            customer_email: `c${String(i).padStart(3, '0')}@example.com`,
            id: `order-${i}`,
          })
        )
      );

      const result = await runQuery();
      const emails = result.map((r) => r.customer_email);

      // Assert: freshest retained, stalest dropped.
      expect(emails).toContain('c000@example.com');
      expect(emails).not.toContain(
        `c${String(FOLLOW_UP_QUERY_LIMIT + 4).padStart(3, '0')}@example.com`
      );
    });
  });

  it('propagates Supabase errors from the follow-up query', async () => {
    fake().setError({ message: 'supabase failure' });

    await expect(runQuery()).rejects.toEqual({ message: 'supabase failure' });
  });

  describe('bugfix: staff invoices treated as abandoned checkouts', () => {
    async function followUpFilter(): Promise<string> {
      await runQuery();
      const orCall = fake().calls.find((call) => call.method === 'or');
      if (!orCall) throw new Error('follow-up query applied no or() filter');
      return String(orCall.args[0]);
    }

    const staleCheckout = {
      created_at: daysBefore(1),
      payment_method: 'bank_transfer',
      recorded_by_user_id: null,
      source: 'online_store',
    };

    it.each([
      'pending',
      'unpaid',
    ])('keeps a stale %s staff invoice out of follow-up', async (paymentStatus) => {
      const filter = await followUpFilter();

      expect(
        matchesOrFilter(
          {
            ...staleCheckout,
            payment_status: paymentStatus,
            recorded_by_user_id: 'staff-user-1',
            source: 'physical',
          },
          filter
        )
      ).toBe(false);
    });

    it.each([
      'pending',
      'unpaid',
    ])('keeps a stale %s WhatsApp order with a cleared creator out of follow-up', async (paymentStatus) => {
      const filter = await followUpFilter();

      expect(
        matchesOrFilter(
          {
            ...staleCheckout,
            payment_status: paymentStatus,
            source: 'whatsapp',
          },
          filter
        )
      ).toBe(false);
    });

    it.each([
      'pending',
      'unpaid',
    ])('still follows up a stale %s customer checkout', async (paymentStatus) => {
      const filter = await followUpFilter();

      expect(
        matchesOrFilter(
          { ...staleCheckout, payment_status: paymentStatus },
          filter
        )
      ).toBe(true);
    });

    it('still follows up a staff invoice whose payment failed', async () => {
      const filter = await followUpFilter();

      expect(
        matchesOrFilter(
          {
            ...staleCheckout,
            payment_status: 'failed',
            recorded_by_user_id: 'staff-user-1',
            source: 'physical',
          },
          filter
        )
      ).toBe(true);
    });
  });
});
