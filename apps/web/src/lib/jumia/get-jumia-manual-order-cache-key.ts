/**
 * Manual order syncs run inside the selected integration scope, so synced
 * orders belong to that marketplace when the shop's provider order set is
 * unambiguous. When several business clients share one shop scope, Jumia's
 * orders API cannot attribute rows to a marketplace; keep the explicitly
 * ambiguous neutral scope (matching the worker's shared-scope rule) instead
 * of stamping the initiator's key and churning rows between siblings.
 */
export function getJumiaManualOrderCacheKey(
  marketplaceKey: string | null | undefined,
  options?: { ambiguousScope?: boolean }
): string {
  if (options?.ambiguousScope) return 'default';
  const trimmed = marketplaceKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'default';
}
