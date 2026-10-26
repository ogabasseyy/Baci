import { getCachedCategoryPageData } from '@/lib/cached-data';

type CategoryPageData = Awaited<ReturnType<typeof getCachedCategoryPageData>>;

/**
 * Optional-content fallback around the category page data loader.
 * Price-band link verification is supplemental SEO content — a transient
 * failure or timeout degrades to dropping the band link instead of erroring
 * the article or emitting a band the destination would noindex.
 */
export async function loadCategoryPageDataSafely(args: {
  merchantId: string;
  categorySlug: string;
  storeSlug: string;
}): Promise<CategoryPageData | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getCachedCategoryPageData(
        args.merchantId,
        args.categorySlug,
        args.storeSlug
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('category page data timeout')),
          3_000
        );
      }),
    ]);
  } catch (error) {
    console.warn('Failed to load category page data for band check', {
      categorySlug: args.categorySlug,
      merchantId: args.merchantId,
      error,
    });
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
