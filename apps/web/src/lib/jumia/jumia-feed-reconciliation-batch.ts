export const MAX_FEEDS_PER_REQUEST = 25;

export type PendingFeedMapping = {
  id: string;
  last_feed_id: string | null;
  jumia_seller_sku: string | null;
  last_synced_at: string | null;
  sync_error?: string | null;
};

export function selectPendingFeedIds(
  mappings: PendingFeedMapping[],
  limit = MAX_FEEDS_PER_REQUEST
): string[] {
  const oldestByFeed = new Map<string, number>();

  for (const mapping of mappings) {
    if (!mapping.last_feed_id) {
      continue;
    }
    const parsed = mapping.last_synced_at
      ? Date.parse(mapping.last_synced_at)
      : 0;
    const timestamp = Number.isFinite(parsed) ? parsed : 0;
    const current = oldestByFeed.get(mapping.last_feed_id);
    if (current === undefined || timestamp < current) {
      oldestByFeed.set(mapping.last_feed_id, timestamp);
    }
  }

  return [...oldestByFeed.entries()]
    .sort(
      (left, right) => left[1] - right[1] || left[0].localeCompare(right[0])
    )
    .slice(0, limit)
    .map(([feedId]) => feedId);
}
