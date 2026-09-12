import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

const INTERNAL_REVALIDATE_PRODUCTS_MAX_ENTRIES = 1000;

/**
 * Keep import purge entries within the internal revalidation request limit.
 * Large imports request a hostname-wide purge separately; these representatives
 * keep the request schema bounded while retaining one category hint per group.
 */
export function boundImportPurgeEntries(
  entries: readonly InternalRevalidateProductEntry[]
): InternalRevalidateProductEntry[] {
  if (entries.length <= INTERNAL_REVALIDATE_PRODUCTS_MAX_ENTRIES) {
    return [...entries];
  }

  const byCategory = new Map<string, InternalRevalidateProductEntry>();
  for (const entry of entries) {
    const key = (entry.categorySlug || entry.category || '')
      .trim()
      .toLowerCase();
    if (!byCategory.has(key)) {
      byCategory.set(key, entry);
    }
  }

  return Array.from(byCategory.values()).slice(
    0,
    INTERNAL_REVALIDATE_PRODUCTS_MAX_ENTRIES
  );
}
