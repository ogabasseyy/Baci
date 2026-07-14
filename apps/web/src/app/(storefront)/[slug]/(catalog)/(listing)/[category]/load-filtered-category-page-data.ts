import {
  getCachedCategoryPageData,
  getCachedCategoryPageGraphicsOptions,
} from '@/lib/cached-data';
import { resolveCategoryGraphicsFilters } from './resolve-category-graphics-filters';

interface LoadFilteredCategoryPageDataOptions {
  category: string;
  merchantId: string;
  productLimit: number;
  productOffset: number;
  rawGraphics: string | string[] | undefined;
  storeSlug: string;
}

export async function loadFilteredCategoryPageData({
  category,
  merchantId,
  productLimit,
  productOffset,
  rawGraphics,
  storeSlug,
}: LoadFilteredCategoryPageDataOptions) {
  const [initialData, graphicsOptions] = await Promise.all([
    getCachedCategoryPageData(
      merchantId,
      category,
      storeSlug,
      productOffset,
      productLimit
    ),
    getCachedCategoryPageGraphicsOptions(merchantId, category, storeSlug),
  ]);
  const selectedGraphics = resolveCategoryGraphicsFilters(
    rawGraphics,
    graphicsOptions
  );
  const data =
    selectedGraphics.length > 0
      ? await getCachedCategoryPageData(
          merchantId,
          category,
          storeSlug,
          productOffset,
          productLimit,
          { graphics: selectedGraphics }
        )
      : initialData;

  return { data, graphicsOptions, selectedGraphics };
}
