/**
 * Manual order syncs run inside the selected integration scope, so synced
 * orders belong to that marketplace. Scoped order reads exclude the neutral
 * cache scope for multi-marketplace shops, so always writing 'default'
 * would hide newly synced orders (and move correctly scoped rows).
 */
export function getJumiaManualOrderCacheKey(
  marketplaceKey: string | null | undefined
): string {
  const trimmed = marketplaceKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'default';
}
