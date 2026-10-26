import { getCachedCompareCategoryInventory } from './get-cached-compare-category-inventory';

type CompareCategoryInventory = Awaited<
  ReturnType<typeof getCachedCompareCategoryInventory>
>;

/**
 * Optional-content fallback around the compare category inventory.
 * Brand-compare and price-band links are supplemental SEO content — a
 * transient inventory failure degrades to no such links instead of erroring
 * the page or emitting a destination the compare page would reject.
 */
export async function loadCompareCategoryInventorySafely(args: {
  merchantId: string;
  categorySlug: string;
}): Promise<CompareCategoryInventory | null> {
  try {
    return await getCachedCompareCategoryInventory(
      args.merchantId,
      args.categorySlug
    );
  } catch (error) {
    console.warn('Failed to load compare category inventory', {
      categorySlug: args.categorySlug,
      merchantId: args.merchantId,
      error,
    });
    return null;
  }
}
