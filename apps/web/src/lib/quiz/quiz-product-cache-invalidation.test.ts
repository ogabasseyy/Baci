import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockScheduleOrderProductBlogPurge } = vi.hoisted(() => ({
  mockScheduleOrderProductBlogPurge: vi.fn(),
}));

vi.mock('@/lib/schedule-order-product-blog-purge', () => ({
  scheduleOrderProductBlogPurge: mockScheduleOrderProductBlogPurge,
}));

import { invalidateQuizProductCaches } from './quiz-product-cache-invalidation';
import {
  createClient,
  makeWatermarks,
} from './quiz-product-cache-invalidation.test-helpers';

describe('invalidateQuizProductCaches', () => {
  beforeEach(() => {
    mockScheduleOrderProductBlogPurge.mockReset();
  });

  it('schedules linked article purges for changed prize events and expired awards', async () => {
    const client = createClient();

    await invalidateQuizProductCaches(client as never, makeWatermarks());

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

    await invalidateQuizProductCaches(client as never, makeWatermarks());

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

    await invalidateQuizProductCaches(client as never, makeWatermarks());

    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalled();
  });

  it('paginates target sweeps beyond a single batch', async () => {
    const reservationRows = Array.from({ length: 1001 }, (_, index) => ({
      merchant_id: 'merchant-3',
      product_id: `product-${index}`,
    }));
    const client = createClient(reservationRows);

    await invalidateQuizProductCaches(client as never, makeWatermarks());

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

      await invalidateQuizProductCaches(client as never, makeWatermarks());

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

    await invalidateQuizProductCaches(client as never, makeWatermarks());

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
});
