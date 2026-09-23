import { getCachedCategoryPageShellData } from '@/lib/cached-category-page-shell';
import type { CachedCategoryPageShellData } from '@/lib/cached-category-page-shell-types';
import { getCategoryFallbackName } from '@/lib/get-category-fallback-name';

/** Fail-open wrapper around the cached category shell for public routes. */
export async function getCategoryPageShellData(
  merchantId: string,
  categorySlug: string
): Promise<CachedCategoryPageShellData> {
  try {
    return await getCachedCategoryPageShellData(merchantId, categorySlug);
  } catch (error) {
    console.error('Category shell query error:', error);
    const fallbackName = getCategoryFallbackName(categorySlug);
    return {
      isCollection: false,
      category: null,
      fallbackName,
      fallbackDescription: `Browse our collection of ${fallbackName} products.`,
      isInactiveCategory: false,
      categoryQueryFailed: true,
      productScope: { kind: 'none' },
    };
  }
}
