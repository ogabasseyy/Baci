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
import { serializeBoundaryRowState } from './quiz-sweep-watermarks';

describe('invalidateQuizProductCaches boundary and delivery semantics', () => {
  beforeEach(() => {
    mockScheduleOrderProductBlogPurge.mockReset();
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

    await invalidateQuizProductCaches(client as never, makeWatermarks());

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
      const run = invalidateQuizProductCaches(
        client as never,
        makeWatermarks()
      );

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

  it('skips unmodified boundary rows at T_max while sweeping in-place updates and new rows sharing T_max', async () => {
    const boundaryTimestamp = '2026-09-01T00:00:00.000Z';
    const unchangedReservation = {
      id: 'res-unchanged',
      merchant_id: 'merchant-unchanged',
      product_id: 'prod-unchanged',
      state: 'reserved',
      quantity: 1,
      updated_at: boundaryTimestamp,
    };
    const preRpcUpdatedReservation = {
      id: 'res-updated',
      merchant_id: 'merchant-updated',
      product_id: 'prod-updated',
      state: 'reserved',
      quantity: 1,
      updated_at: boundaryTimestamp,
    };
    const postRpcUpdatedReservation = {
      ...preRpcUpdatedReservation,
      // Same id and same timestamp T_max, but state changed in place!
      state: 'released',
      release_reason: 'expired',
      updated_at: '2026-09-01T00:00:00+00:00',
    };
    const newlyInsertedAtBoundary = {
      id: 'res-new-same-ts',
      merchant_id: 'merchant-new',
      product_id: 'prod-new',
      state: 'reserved',
      quantity: 1,
      updated_at: boundaryTimestamp,
    };

    const client = createClient([
      unchangedReservation,
      postRpcUpdatedReservation,
      newlyInsertedAtBoundary,
    ]);

    const boundarySnapshots = new Map<string, string>([
      [
        'res-unchanged',
        serializeBoundaryRowState(
          'quiz_prize_reservations',
          unchangedReservation
        ),
      ],
      [
        'res-updated',
        serializeBoundaryRowState(
          'quiz_prize_reservations',
          preRpcUpdatedReservation
        ),
      ],
    ]);

    const watermarks = makeWatermarks(boundaryTimestamp, {
      reservations: {
        status: 'ok',
        floor: boundaryTimestamp,
        boundarySnapshots,
      },
    });

    await invalidateQuizProductCaches(client as never, watermarks);

    // Unmodified boundary row is skipped, while both the in-place updated
    // boundary row and the new row sharing T_max are swept.
    expect(mockScheduleOrderProductBlogPurge).not.toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'merchant-unchanged' })
    );
    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-updated',
        productIds: ['prod-updated'],
      })
    );
    expect(mockScheduleOrderProductBlogPurge).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-new',
        productIds: ['prod-new'],
      })
    );
  });

  it('returns false when a target sweep fails, purge returns false, or purge delivery rejects', async () => {
    const client = createClient();
    mockScheduleOrderProductBlogPurge.mockRejectedValueOnce(
      new Error('purge failed')
    );

    const rejectedResult = await invalidateQuizProductCaches(
      client as never,
      makeWatermarks()
    );
    expect(rejectedResult).toBe(false);

    mockScheduleOrderProductBlogPurge.mockResolvedValueOnce(false);
    const nonThrowingFailureResult = await invalidateQuizProductCaches(
      client as never,
      makeWatermarks()
    );
    expect(nonThrowingFailureResult).toBe(false);

    mockScheduleOrderProductBlogPurge.mockResolvedValueOnce(undefined);
    const undefinedResult = await invalidateQuizProductCaches(
      client as never,
      makeWatermarks()
    );
    expect(undefinedResult).toBe(false);

    mockScheduleOrderProductBlogPurge.mockResolvedValue(true);
    const completeResult = await invalidateQuizProductCaches(
      client as never,
      makeWatermarks()
    );
    expect(completeResult).toBe(true);

    const invalidClientResult = await invalidateQuizProductCaches(
      {} as never,
      makeWatermarks()
    );
    expect(invalidClientResult).toBe(false);
  });
});
