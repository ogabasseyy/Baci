import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockScheduleOrderProductBlogPurge } = vi.hoisted(() => ({
  mockScheduleOrderProductBlogPurge: vi.fn(),
}));

vi.mock('@/lib/schedule-order-product-blog-purge', () => ({
  scheduleOrderProductBlogPurge: mockScheduleOrderProductBlogPurge,
}));

import { invalidateQuizProductCaches } from './quiz-product-cache-invalidation';

function createClient(
  reservationRows: unknown[] = [],
  options: {
    failReservationsAfterFirstPage?: boolean;
  } = {}
) {
  const eventRows = [
    {
      id: 'event-1',
      merchant_id: 'merchant-1',
      settings: { prize_product_id: 'product-1' },
    },
    {
      id: 'event-2',
      merchant_id: 'merchant-2',
      settings: { title: 'Trivia only' },
    },
  ];
  const awardRows = [
    {
      event_id: 'event-2',
      product_id: 'product-2',
      quiz_events: { merchant_id: 'merchant-2' },
    },
  ];
  const orderCalls: Array<{ column: unknown; table: string }> = [];
  const inCalls: Array<{ column: unknown; table: string }> = [];
  return {
    orderCalls,
    inCalls,
    from: vi.fn((table: string) => {
      const rows: unknown[] =
        table === 'quiz_events'
          ? eventRows
          : table === 'quiz_awards'
            ? awardRows
            : table === 'quiz_prize_reservations'
              ? reservationRows
              : [];
      const builder: {
        data: unknown;
        error: unknown;
        select: ReturnType<typeof vi.fn>;
        gte: ReturnType<typeof vi.fn>;
        order: ReturnType<typeof vi.fn>;
        range: ReturnType<typeof vi.fn>;
        not: ReturnType<typeof vi.fn>;
        in: ReturnType<typeof vi.fn>;
      } = {
        data: rows,
        error: null,
        select: vi.fn(() => builder),
        gte: vi.fn(() => builder),
        order: vi.fn((column: unknown) => {
          orderCalls.push({ table, column });
          return builder;
        }),
        range: vi.fn((from: number, to: number) => {
          if (
            options.failReservationsAfterFirstPage &&
            table === 'quiz_prize_reservations' &&
            from > 0
          ) {
            throw new Error('page unavailable');
          }
          builder.data = rows.slice(from, to + 1);
          return builder;
        }),
        not: vi.fn(() => builder),
        in: vi.fn((column: unknown) => {
          inCalls.push({ table, column });
          return builder;
        }),
      };
      return builder;
    }),
  };
}

describe('invalidateQuizProductCaches', () => {
  beforeEach(() => {
    mockScheduleOrderProductBlogPurge.mockReset();
  });

  it('schedules linked article purges for changed prize events and expired awards', async () => {
    const client = createClient();

    await invalidateQuizProductCaches(client as never, {
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:00:00Z',
      awards: '2026-09-01T00:00:00Z',
    });

    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      supabase: client,
    });
    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-2',
      productIds: ['product-2'],
      supabase: client,
    });
    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledTimes(2);
  });

  it('schedules product purges for reservation and release transitions', async () => {
    const client = createClient([
      { merchant_id: 'merchant-3', product_id: 'product-3' },
    ]);

    await invalidateQuizProductCaches(client as never, {
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:00:00Z',
      awards: '2026-09-01T00:00:00Z',
    });

    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-3',
      productIds: ['product-3'],
      supabase: client,
    });
  });

  it('does not invalidate non-product quiz events', async () => {
    const client = createClient();
    client.from = vi.fn(() => ({
      data: [{ merchant_id: 'merchant-2', settings: { title: 'Trivia only' } }],
      error: null,
      select: vi.fn(function (this: unknown) {
        return this;
      }),
      gte: vi.fn(function (this: unknown) {
        return this;
      }),
      order: vi.fn(function (this: unknown) {
        return this;
      }),
      range: vi.fn(function (this: unknown) {
        return this;
      }),
      not: vi.fn(function (this: unknown) {
        return this;
      }),
      in: vi.fn(function (this: unknown) {
        return this;
      }),
    })) as never;

    await invalidateQuizProductCaches(client as never, {
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:00:00Z',
      awards: '2026-09-01T00:00:00Z',
    });

    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
  });

  it('paginates target sweeps beyond a single batch', async () => {
    const reservationRows = Array.from({ length: 1001 }, (_, index) => ({
      merchant_id: 'merchant-3',
      product_id: `product-${index}`,
    }));
    const client = createClient(reservationRows);

    await invalidateQuizProductCaches(client as never, {
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:00:00Z',
      awards: '2026-09-01T00:00:00Z',
    });

    const merchantCall = mockScheduleOrderProductBlogPurge.mock.calls.find(
      ([input]) =>
        (input as { merchantId?: string }).merchantId === 'merchant-3'
    );
    const productIds = (merchantCall?.[0] as { productIds?: string[] })
      ?.productIds;
    expect(productIds).toHaveLength(1001);
    expect(productIds?.[0]).toBe('product-0');
    expect(productIds?.[1000]).toBe('product-1000');
  });

  it('escalates collected merchants when a later sweep page fails', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const reservationRows = Array.from({ length: 1001 }, (_, index) => ({
        merchant_id: 'merchant-3',
        product_id: `product-${index}`,
      }));
      const client = createClient(reservationRows, {
        failReservationsAfterFirstPage: true,
      });

      await invalidateQuizProductCaches(client as never, {
        events: '2026-09-01T00:00:00Z',
        reservations: '2026-09-01T00:00:00Z',
        awards: '2026-09-01T00:00:00Z',
      });

      const expectedIds = Array.from(
        { length: 1000 },
        (_, index) => `product-${index}`
      );
      expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith({
        merchantId: 'merchant-3',
        productIds: expectedIds,
        supabase: client,
        targetSweepIncomplete: true,
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('sweep incomplete'),
        expect.objectContaining({
          watermarks: {
            events: '2026-09-01T00:00:00Z',
            reservations: '2026-09-01T00:00:00Z',
            awards: '2026-09-01T00:00:00Z',
          },
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('attributes expired awards from the embedded merchant without an owner query', async () => {
    const client = createClient([]);

    await invalidateQuizProductCaches(client as never, {
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:00:00Z',
      awards: '2026-09-01T00:00:00Z',
    });

    // The award-only merchant is invalidated from the embedded event
    // merchant riding with the award rows: no separate owner lookup can
    // fail and strand the awards with zero targets.
    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith({
      merchantId: 'merchant-2',
      productIds: ['product-2'],
      supabase: client,
    });
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetSweepIncomplete: true })
    );
    expect(client.inCalls).toEqual([]);
  });

  it('orders every sweep by a unique id tie-breaker', async () => {
    // Set-based RPCs can stamp 1,000+ rows with the same timestamp; a
    // timestamp-only offset order would duplicate or omit boundary rows.
    const reservationRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `reservation-${String(index).padStart(4, '0')}`,
      merchant_id: 'merchant-3',
      product_id: `product-${index}`,
      updated_at: '2026-09-01T00:00:00Z',
    }));
    const client = createClient(reservationRows);

    await invalidateQuizProductCaches(client as never, {
      events: '2026-09-01T00:00:00Z',
      reservations: '2026-09-01T00:00:00Z',
      awards: '2026-09-01T00:00:00Z',
    });

    for (const table of [
      'quiz_events',
      'quiz_prize_reservations',
      'quiz_awards',
    ]) {
      expect(
        client.orderCalls.filter((call) => call.table === table)
      ).toContainEqual({ table, column: 'id' });
    }
    const merchantCall = mockScheduleOrderProductBlogPurge.mock.calls.find(
      ([input]) =>
        (input as { merchantId?: string }).merchantId === 'merchant-3'
    );
    expect(
      (merchantCall?.[0] as { productIds?: string[] })?.productIds
    ).toHaveLength(1001);
  });

  it('delivers merchant purges in bounded-concurrency chunks', async () => {
    // Six merchants, five per chunk: the first chunk must all be in flight
    // before any of them resolves (no serial 5s-each delivery under the
    // worker SIGTERM budget), and the sixth waits for the next chunk.
    const reservationRows = Array.from({ length: 4 }, (_, index) => ({
      merchant_id: `merchant-${index + 3}`,
      product_id: `product-${index + 3}`,
    }));
    const client = createClient(reservationRows);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockScheduleOrderProductBlogPurge.mockImplementation(() => gate);
    try {
      const run = invalidateQuizProductCaches(client as never, {
        events: '2026-09-01T00:00:00Z',
        reservations: '2026-09-01T00:00:00Z',
        awards: '2026-09-01T00:00:00Z',
      });

      await vi.waitFor(() =>
        expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledTimes(5)
      );
      // Chunk two has not started while chunk one is still in flight.
      expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledTimes(5);
      release();
      await run;
      expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledTimes(6);
    } finally {
      mockScheduleOrderProductBlogPurge.mockReset();
    }
  });
});
