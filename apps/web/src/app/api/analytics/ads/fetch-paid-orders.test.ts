import { describe, expect, it, vi } from 'vitest';
import { fetchPaidOrdersForAnalytics } from './fetch-paid-orders';

function createQuery(limit: (count: number) => Promise<unknown>) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['eq', 'gte', 'lte', 'or', 'order', 'select']) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn(limit);
  return query;
}

describe('fetchPaidOrdersForAnalytics', () => {
  it('reads every page with a deterministic order', async () => {
    const pages = [
      {
        data: Array.from({ length: 500 }, (_, index) => ({
          ad_tracking: { gclid: `first-${index}` },
          created_at: new Date(
            Date.parse('2026-08-02T00:00:00.000Z') - index * 1000
          ).toISOString(),
          id: `order-${500 - index}`,
          payment_status: 'paid',
          total: 100,
        })),
        error: null,
      },
      {
        data: [
          {
            ad_tracking: { gclid: 'second' },
            created_at: '2026-08-01T00:00:00.000Z',
            id: 'order-0',
            payment_status: 'paid',
            total: 200,
          },
        ],
        error: null,
      },
    ];
    let page = 0;
    const query = createQuery(
      async () => pages[page++] ?? { data: [], error: null }
    );
    const from = vi.fn(() => query);

    const result = await fetchPaidOrdersForAnalytics(
      { from } as never,
      'merchant-1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T23:59:59.999Z'
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(501);
    expect(result.data[0]?.id).toBe('order-500');
    expect(result.data.at(-1)?.id).toBe('order-0');
    expect(query.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: false,
    });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: false,
    });
    expect(query.limit).toHaveBeenNthCalledWith(1, 500);
    expect(query.limit).toHaveBeenNthCalledWith(2, 500);
    expect(query.or).toHaveBeenCalledWith(
      'created_at.lt."2026-08-01T23:51:41.000Z",and(created_at.eq."2026-08-01T23:51:41.000Z",id.lt."order-1")'
    );
  });

  it('does not duplicate or skip rows when paid membership changes between pages', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      ad_tracking: { gclid: `click-${index}` },
      created_at: new Date(
        Date.parse('2026-08-02T00:00:00.000Z') - index * 1000
      ).toISOString(),
      id: `order-${500 - index}`,
      payment_status: 'paid' as const,
      total: 100,
    }));
    const olderOrder = {
      ad_tracking: { gclid: 'older' },
      created_at: '2026-08-01T00:00:00.000Z',
      id: 'order-0',
      payment_status: 'paid' as const,
      total: 200,
    };
    let request = 0;
    const query = createQuery(async () => {
      request += 1;
      if (request === 1) return { data: firstPage, error: null };

      // A newer order becoming paid would shift offset page 2 and duplicate the
      // prior page tail. A keyset request remains strictly below that tail.
      return { data: [olderOrder], error: null };
    });

    const result = await fetchPaidOrdersForAnalytics(
      { from: vi.fn(() => query) } as never,
      'merchant-1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T23:59:59.999Z'
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(501);
    expect(new Set(result.data.map(({ id }) => id)).size).toBe(501);
    expect(result.data.at(-1)).toEqual(olderOrder);
    expect(query.or).toHaveBeenCalledOnce();
  });

  it('returns the database error without exposing a partial order set', async () => {
    const databaseError = { message: 'orders unavailable' };
    const query = createQuery(async () => ({
      data: null,
      error: databaseError,
    }));

    const result = await fetchPaidOrdersForAnalytics(
      { from: vi.fn(() => query) } as never,
      'merchant-1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T23:59:59.999Z'
    );

    expect(result).toEqual({ data: [], error: databaseError });
  });

  it('fails closed when a full page cannot produce a non-null cursor', async () => {
    const query = createQuery(async () => ({
      data: Array.from({ length: 500 }, (_, index) => ({
        ad_tracking: null,
        created_at: index === 499 ? null : '2026-08-01T00:00:00.000Z',
        id: `order-${index}`,
        payment_status: 'paid',
        total: 100,
      })),
      error: null,
    }));

    const result = await fetchPaidOrdersForAnalytics(
      { from: vi.fn(() => query) } as never,
      'merchant-1',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T23:59:59.999Z'
    );

    expect(result.data).toEqual([]);
    expect(result.error).toEqual(new Error('ANALYTICS_ORDER_CURSOR_INVALID'));
  });
});
