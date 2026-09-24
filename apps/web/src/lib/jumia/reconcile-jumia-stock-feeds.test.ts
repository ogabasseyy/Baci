import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JumiaStockMapping } from './load-jumia-stock-mappings';

const mockGetFeedStatus = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@/lib/jumia/feeds', () => ({
  getFeedStatus: (...args: unknown[]) => mockGetFeedStatus(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { reconcileJumiaStockFeeds, selectStockFeedIdsForReconciliation } =
  await import('./reconcile-jumia-stock-feeds');

function mapping(overrides: Partial<JumiaStockMapping>): JumiaStockMapping {
  return {
    id: 'mapping-1',
    product_id: 'product-1',
    variant_id: null,
    jumia_seller_sku: 'SKU-1',
    jumia_product_id: 'jumia-1',
    baci_stock_at_last_sync: 5,
    last_feed_id: 'feed-1',
    ...overrides,
  };
}

function feed(overrides: Record<string, unknown> = {}) {
  return {
    feedSid: 'feed-1',
    status: 'completed',
    feedType: 'stock',
    feedSource: 'api',
    total: 1,
    completed: 1,
    failed: 0,
    createdBy: { sid: 'u', name: 'u', email: 'u@example.com' },
    feedItems: [],
    ...overrides,
  };
}

function supabase() {
  return {
    from: vi.fn(() => ({
      update: (...args: unknown[]) => ({
        eq: vi.fn().mockImplementation(() => mockUpdate(...args)),
      }),
    })),
  } as never;
}

describe('reconcileJumiaStockFeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ error: null });
  });

  it('skips mappings without an advanced cursor or feed', async () => {
    const mappings = [
      mapping({ baci_stock_at_last_sync: null }),
      mapping({ id: 'mapping-2', last_feed_id: null }),
    ];

    const result = await reconcileJumiaStockFeeds(supabase(), {} as never, {
      mappings,
    });

    expect(result).toEqual({
      feedsChecked: 0,
      cursorsReset: 0,
      feedsConfirmed: 0,
      failures: 0,
    });
    expect(mockGetFeedStatus).not.toHaveBeenCalled();
  });

  it('resets the cursor when the stock feed was rejected', async () => {
    const mappings = [mapping({ baci_stock_at_last_sync: 5 })];
    mockGetFeedStatus.mockResolvedValueOnce(
      feed({ status: 'failed', completed: 0, failed: 1 })
    );

    const result = await reconcileJumiaStockFeeds(supabase(), {} as never, {
      mappings,
    });

    expect(result.cursorsReset).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      baci_stock_at_last_sync: null,
      last_stock_synced_at: null,
      last_feed_id: null,
    });
    // Patched in place so the caller re-pushes the mapping in the same run.
    expect(mappings[0]?.baci_stock_at_last_sync).toBeNull();
    expect(mappings[0]?.last_feed_id).toBeNull();
  });

  it('resets only the rejected SKU on a partially failed feed', async () => {
    const mappings = [
      mapping({ id: 'mapping-ok', jumia_seller_sku: 'SKU-OK' }),
      mapping({ id: 'mapping-bad', jumia_seller_sku: 'SKU-BAD' }),
    ];
    mockGetFeedStatus.mockResolvedValueOnce(
      feed({
        status: 'processing',
        completed: 1,
        failed: 1,
        feedItems: [
          { status: 'success', sellerSKU: 'SKU-OK' },
          { status: 'rejected', sellerSKU: 'SKU-BAD' },
        ],
      })
    );

    const result = await reconcileJumiaStockFeeds(supabase(), {} as never, {
      mappings,
    });

    expect(result.cursorsReset).toBe(1);
    expect(result.feedsConfirmed).toBe(1);
    expect(mappings[0]?.baci_stock_at_last_sync).toBe(5);
    expect(mappings[0]?.last_feed_id).toBeNull();
    expect(mappings[1]?.baci_stock_at_last_sync).toBeNull();
  });

  it('confirms accepted feeds so they are not re-checked', async () => {
    const mappings = [mapping({})];
    mockGetFeedStatus.mockResolvedValueOnce(feed({ status: 'completed' }));

    const result = await reconcileJumiaStockFeeds(supabase(), {} as never, {
      mappings,
    });

    expect(result.feedsConfirmed).toBe(1);
    expect(result.cursorsReset).toBe(0);
    expect(mockUpdate).toHaveBeenCalledWith({ last_feed_id: null });
    expect(mappings[0]?.baci_stock_at_last_sync).toBe(5);
    expect(mappings[0]?.last_feed_id).toBeNull();
  });

  it('leaves the cursor on lookup failure and processes other feeds', async () => {
    const mappings = [
      mapping({ id: 'mapping-gone', last_feed_id: 'feed-gone' }),
      mapping({ id: 'mapping-failed', last_feed_id: 'feed-failed' }),
    ];
    mockGetFeedStatus.mockImplementation((_client: unknown, feedId: string) => {
      if (feedId === 'feed-gone') {
        return Promise.reject(new Error('feed expired'));
      }
      return Promise.resolve(
        feed({ status: 'failed', completed: 0, failed: 1 })
      );
    });

    const result = await reconcileJumiaStockFeeds(supabase(), {} as never, {
      mappings,
    });

    expect(result.feedsChecked).toBe(1);
    expect(result.cursorsReset).toBe(1);
    expect(mappings[0]?.baci_stock_at_last_sync).toBe(5);
    expect(mappings[0]?.last_feed_id).toBe('feed-gone');
    expect(mappings[1]?.baci_stock_at_last_sync).toBeNull();
  });

  it('resets rejected items inside an otherwise completed feed', async () => {
    const mappings = [
      mapping({ id: 'mapping-ok', jumia_seller_sku: 'SKU-OK' }),
      mapping({ id: 'mapping-bad', jumia_seller_sku: 'SKU-BAD' }),
      mapping({ id: 'mapping-unlisted', jumia_seller_sku: 'SKU-UNLISTED' }),
    ];
    mockGetFeedStatus.mockResolvedValueOnce(
      feed({
        status: 'completed',
        completed: 2,
        failed: 1,
        feedItems: [
          { status: 'success', sellerSKU: 'SKU-OK' },
          { status: 'rejected', sellerSKU: 'SKU-BAD' },
        ],
      })
    );

    const result = await reconcileJumiaStockFeeds(supabase(), {} as never, {
      mappings,
    });

    expect(result).toMatchObject({
      feedsChecked: 1,
      cursorsReset: 1,
      feedsConfirmed: 2,
    });
    expect(mappings[0]?.last_feed_id).toBeNull();
    expect(mappings[0]?.baci_stock_at_last_sync).toBe(5);
    expect(mappings[1]?.baci_stock_at_last_sync).toBeNull();
    expect(mappings[1]?.last_feed_id).toBeNull();
    // Feed-level success settles SKUs the feed never itemized.
    expect(mappings[2]?.last_feed_id).toBeNull();
    expect(mappings[2]?.baci_stock_at_last_sync).toBe(5);
  });

  it('counts persistence failures without patching the mapping', async () => {
    const mappings = [mapping({})];
    mockGetFeedStatus.mockResolvedValueOnce(
      feed({ status: 'failed', completed: 0, failed: 1 })
    );
    mockUpdate.mockResolvedValueOnce({ error: { message: 'RLS denied' } });

    const result = await reconcileJumiaStockFeeds(supabase(), {} as never, {
      mappings,
    });

    expect(result).toMatchObject({ cursorsReset: 0, failures: 1 });
    expect(mappings[0]?.baci_stock_at_last_sync).toBe(5);
    expect(mappings[0]?.last_feed_id).toBe('feed-1');
  });
});

describe('selectStockFeedIdsForReconciliation', () => {
  const DAY_MS = 86_400_000;

  it('returns every feed when under the limit', () => {
    expect(
      selectStockFeedIdsForReconciliation(['feed-b', 'feed-a'], 25, 0)
    ).toEqual(['feed-a', 'feed-b']);
  });

  it('rotates the window by day so stuck heads cannot starve the tail', () => {
    const feeds = Array.from(
      { length: 30 },
      (_, index) => `feed-${String(index).padStart(2, '0')}`
    );
    const dayZero = selectStockFeedIdsForReconciliation(feeds, 25, 0);
    const dayFive = selectStockFeedIdsForReconciliation(feeds, 25, 5 * DAY_MS);

    expect(dayZero).toHaveLength(25);
    expect(dayFive).toHaveLength(25);
    expect(dayZero[0]).toBe('feed-00');
    expect(dayFive[0]).toBe('feed-05');
    // Sorted order with wrap-around: later days reach feeds past the cap.
    expect(dayFive).toContain('feed-29');
    expect(dayZero).not.toContain('feed-29');
  });

  it('advances by a full batch per day so large backlogs rotate quickly', () => {
    const feeds = Array.from(
      { length: 100 },
      (_, index) => `feed-${String(index).padStart(3, '0')}`
    );
    const dayZero = selectStockFeedIdsForReconciliation(feeds, 25, 0);
    const dayOne = selectStockFeedIdsForReconciliation(feeds, 25, DAY_MS);

    // Day one starts where day zero stopped instead of one position later,
    // covering all 100 feeds within four days.
    expect(dayZero[0]).toBe('feed-000');
    expect(dayOne[0]).toBe('feed-025');
    const covered = new Set<string>();
    for (let day = 0; day < 4; day += 1) {
      for (const feed of selectStockFeedIdsForReconciliation(
        feeds,
        25,
        day * DAY_MS
      )) {
        covered.add(feed);
      }
    }
    expect(covered.size).toBe(100);
  });
});
