import { describe, expect, it, vi } from 'vitest';
import { updateJumiaStockTracking } from './update-jumia-stock-tracking';

function updateQuery(result: { error: unknown }) {
  return {
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue(result),
    })),
  };
}

describe('updateJumiaStockTracking', () => {
  it('advances tracking with scoped per-row updates', async () => {
    const query = updateQuery({ error: null });
    const supabase = { from: vi.fn(() => query) } as never;

    const result = await updateJumiaStockTracking(supabase, {
      updates: [
        { mappingId: 'mapping-1', stock: 5 },
        { mappingId: 'mapping-2', stock: 0 },
      ],
      feedId: 'feed-1',
    });

    expect(result).toEqual({ trackingFailures: 0 });
    expect(query.update).toHaveBeenCalledTimes(2);
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        baci_stock_at_last_sync: 5,
        last_feed_id: 'feed-1',
      })
    );
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        baci_stock_at_last_sync: 0,
        last_feed_id: 'feed-1',
      })
    );
  });

  it('counts per-row tracking failures instead of failing the batch', async () => {
    const update = vi
      .fn()
      .mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ error: { message: 'boom' } }),
      })
      .mockReturnValueOnce({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const supabase = { from: vi.fn(() => ({ update })) } as never;

    const result = await updateJumiaStockTracking(supabase, {
      updates: [
        { mappingId: 'mapping-1', stock: 5 },
        { mappingId: 'mapping-2', stock: 0 },
      ],
      feedId: 'feed-1',
    });

    expect(result).toEqual({ trackingFailures: 1 });
  });

  it('omits the feed id when the provider returns none', async () => {
    const query = updateQuery({ error: null });
    const supabase = { from: vi.fn(() => query) } as never;

    await updateJumiaStockTracking(supabase, {
      updates: [{ mappingId: 'mapping-1', stock: 5 }],
      feedId: null,
    });

    expect(query.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ last_feed_id: expect.anything() })
    );
  });
});
