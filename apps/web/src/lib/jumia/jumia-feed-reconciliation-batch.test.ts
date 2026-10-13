import { describe, expect, it } from 'vitest';
import { selectPendingFeedIds } from './jumia-feed-reconciliation-batch';

describe('selectPendingFeedIds', () => {
  it('rotates later feeds ahead of recently checked prefixes', () => {
    const feedIds = selectPendingFeedIds(
      Array.from({ length: 26 }, (_, index) => ({
        id: `mapping-${index}`,
        last_feed_id: `feed-${String(index + 1).padStart(2, '0')}`,
        jumia_seller_sku: `SKU-${index}`,
        last_synced_at:
          index < 25 ? '2026-08-15T12:00:00.000Z' : '2026-08-01T00:00:00.000Z',
      })),
      25
    );

    expect(feedIds).toHaveLength(25);
    expect(feedIds[0]).toBe('feed-26');
    expect(feedIds).not.toContain('feed-25');
  });
});
