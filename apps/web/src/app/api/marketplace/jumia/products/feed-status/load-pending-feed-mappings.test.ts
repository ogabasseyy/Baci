import { describe, expect, it, vi } from 'vitest';
import { loadPendingFeedMappings } from './load-pending-feed-mappings';

function page(rows: unknown[], error: unknown = null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.not.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  return builder;
}

describe('loadPendingFeedMappings', () => {
  it('loads every page instead of stopping at the PostgREST limit', async () => {
    const first = Array.from({ length: 500 }, (_, index) => ({
      id: `mapping-${index}`,
      last_feed_id: `feed-${index}`,
      jumia_seller_sku: `SKU-${index}`,
      last_synced_at: null,
      sync_error: null,
    }));
    const second = page([
      {
        id: 'mapping-500',
        last_feed_id: 'feed-500',
        jumia_seller_sku: 'SKU-500',
        last_synced_at: null,
        sync_error: null,
      },
    ]);
    const firstBuilder = page(first);
    const from = vi
      .fn()
      .mockReturnValueOnce(firstBuilder)
      .mockReturnValueOnce(second);

    const result = await loadPendingFeedMappings(
      { from } as never,
      'merchant-1',
      'shop-1',
      'marketplace-1'
    );

    expect(result.error).toBeNull();
    expect(result.mappings).toHaveLength(501);
    expect(firstBuilder.range).toHaveBeenCalledWith(0, 499);
    expect(second.range).toHaveBeenCalledWith(500, 999);
  });

  it('returns an error without partial mappings when a later page fails', async () => {
    const firstBuilder = page(
      Array.from({ length: 500 }, (_, index) => ({
        id: `mapping-${index}`,
        last_feed_id: `feed-${index}`,
        jumia_seller_sku: null,
        last_synced_at: null,
        sync_error: null,
      }))
    );
    const second = page([], { message: 'database unavailable' });
    const from = vi
      .fn()
      .mockReturnValueOnce(firstBuilder)
      .mockReturnValueOnce(second);

    const result = await loadPendingFeedMappings(
      { from } as never,
      'merchant-1',
      'shop-1',
      'marketplace-1'
    );

    expect(result.mappings).toEqual([]);
    expect(result.error).toEqual({ message: 'database unavailable' });
  });
});
