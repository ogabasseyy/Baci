import type { BrandAuthorityEntry } from '@/lib/storefront-category/category-hub-types';
import { getCachedBrandAuthorityInventory } from '@/lib/storefront-category/get-cached-brand-authority-inventory';

type BrandAuthorityInventory = Awaited<
  ReturnType<typeof getCachedBrandAuthorityInventory>
>;

/**
 * Optional-content fallback around getCachedBrandAuthorityInventory.
 * Hub links are supplemental SEO content — a transient destination-inventory
 * failure must not error the page, so it degrades to null (no hub link).
 */
const DESTINATION_INVENTORY_TIMEOUT_MS = 3_000;

export async function loadBrandAuthorityInventorySafely(args: {
  merchantId: string;
  categorySlug: string;
  entry: BrandAuthorityEntry;
  timeoutMs?: number;
}): Promise<BrandAuthorityInventory | null> {
  try {
    return await Promise.race([
      getCachedBrandAuthorityInventory(
        args.merchantId,
        args.categorySlug,
        args.entry
      ),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('destination inventory timeout')),
          args.timeoutMs ?? DESTINATION_INVENTORY_TIMEOUT_MS
        );
      }),
    ]);
  } catch (error) {
    console.warn('Failed to load brand authority inventory for hub check', {
      categorySlug: args.categorySlug,
      merchantId: args.merchantId,
      error,
    });
    return null;
  }
}
