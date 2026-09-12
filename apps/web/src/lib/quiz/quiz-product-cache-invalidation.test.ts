import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockScheduleOrderProductBlogPurge } = vi.hoisted(() => ({
  mockScheduleOrderProductBlogPurge: vi.fn(),
}));

vi.mock('@/lib/schedule-order-product-blog-purge', () => ({
  scheduleOrderProductBlogPurge: mockScheduleOrderProductBlogPurge,
}));

import { invalidateQuizProductCaches } from './quiz-product-cache-invalidation';

function createClient(reservationRows: unknown[] = []) {
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
  const awardRows = [{ event_id: 'event-2', product_id: 'product-2' }];
  const expiredEventRows = [{ id: 'event-2', merchant_id: 'merchant-2' }];
  return {
    from: vi.fn((table: string) => {
      const rows: unknown[] =
        table === 'quiz_events'
          ? eventRows
          : table === 'quiz_awards'
            ? awardRows
            : table === 'quiz_prize_reservations'
              ? reservationRows
              : [];
      const builder = {
        data: rows,
        error: null,
        select: vi.fn(() => builder),
        gte: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        not: vi.fn(() => builder),
        in: vi.fn(() => {
          builder.data = table === 'quiz_events' ? expiredEventRows : rows;
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

    await invalidateQuizProductCaches(client as never, '2026-09-01T00:00:00Z');

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

    await invalidateQuizProductCaches(client as never, '2026-09-01T00:00:00Z');

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
      limit: vi.fn(function (this: unknown) {
        return this;
      }),
      not: vi.fn(function (this: unknown) {
        return this;
      }),
      in: vi.fn(function (this: unknown) {
        return this;
      }),
    })) as never;

    await invalidateQuizProductCaches(client as never, '2026-09-01T00:00:00Z');

    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
  });
});
