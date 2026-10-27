import type { BrandAuthorityEntry } from '@/lib/storefront-category/category-hub-types';
import {
  getCachedBrandAuthorityInventory,
  OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS,
} from '@/lib/storefront-category/get-cached-brand-authority-inventory';

type BrandAuthorityInventory = Awaited<
  ReturnType<typeof getCachedBrandAuthorityInventory>
>;
const DESTINATION_INVENTORY_TIMEOUT_MS = 3_000;

/** Optional links fail closed; the shared reader owns scope, hydration and cancellation. */
export async function loadBrandAuthorityInventorySafely(args: {
  merchantId: string;
  categorySlug: string;
  entry: BrandAuthorityEntry;
  timeoutMs?: number;
}): Promise<BrandAuthorityInventory | null> {
  try {
    return await getCachedBrandAuthorityInventory(
      args.merchantId,
      args.categorySlug,
      args.entry,
      {
        maxProducts: OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS,
        timeoutMs: args.timeoutMs ?? DESTINATION_INVENTORY_TIMEOUT_MS,
      }
    );
  } catch (error) {
    console.warn('Failed to load brand authority inventory for hub check', {
      categorySlug: args.categorySlug,
      merchantId: args.merchantId,
      error,
    });
    return null;
  }
}
