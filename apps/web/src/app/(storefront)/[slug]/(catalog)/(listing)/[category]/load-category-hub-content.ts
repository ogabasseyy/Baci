import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import {
  type CachedCategoryPageData,
  getCachedCategoryPageData,
} from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';
import { getCachedBrandAuthorityEntries } from '@/lib/storefront-category/get-cached-brand-authority-entries';
import { loadCompareCategoryInventorySafely } from '@/lib/storefront-compare/load-compare-category-inventory-safely';
import { COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT } from '@/lib/storefront-compare/price-band-taxonomy';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import { loadPublishedClusterPostsSafely } from '@/lib/storefront-content/load-published-cluster-posts-safely';

export async function loadCategoryHubContent(input: {
  merchantId: string;
  categorySlug: string;
  categoryData: CachedCategoryPageData;
  storeSlug?: string;
  includeAuthorityContent?: boolean;
  isFiltered?: boolean;
}) {
  const includeAuthority = input.includeAuthorityContent ?? true;
  const supportedCategory =
    includeAuthority &&
    Object.hasOwn(CONTENT_CLUSTER_SUPPORT, input.categorySlug)
      ? (input.categorySlug as SupportedClusterCategory)
      : null;
  const canLoadAuthority =
    includeAuthority &&
    !input.categoryData.isCollection &&
    !input.categoryData.isInactiveCategory &&
    Boolean(input.categoryData.category?.id);
  const canLoadHubPool =
    !input.categoryData.isCollection &&
    !input.categoryData.isInactiveCategory &&
    Boolean(input.storeSlug);
  const hasHubDefaults = Object.hasOwn(
    CATEGORY_HUB_DEFAULTS,
    input.categorySlug
  );
  const isPageDataSufficient =
    !input.isFiltered &&
    input.categoryData.productCount !== undefined &&
    input.categoryData.products.length >=
      Math.min(
        input.categoryData.productCount,
        COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT
      );
  const shouldFetchHubPool =
    canLoadHubPool && hasHubDefaults && !isPageDataSufficient;

  const [guidePosts, brandAuthorityEntries, hubCategoryData, compareInventory] =
    await Promise.all([
      supportedCategory
        ? loadPublishedClusterPostsSafely(input.merchantId, {
            pageKind: 'category',
            categorySlug: supportedCategory,
          })
        : Promise.resolve([]),
      canLoadAuthority
        ? getCachedBrandAuthorityEntries(input.merchantId, input.categorySlug)
        : Promise.resolve([]),
      shouldFetchHubPool && input.storeSlug
        ? getCachedCategoryPageData(
            input.merchantId,
            input.categorySlug,
            input.storeSlug,
            0,
            COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT
          ).catch((error) => {
            console.warn('Failed to load canonical category hub products', {
              merchantId: input.merchantId,
              categorySlug: input.categorySlug,
              error,
            });
            return null;
          })
        : Promise.resolve(null),
      canLoadAuthority
        ? loadCompareCategoryInventorySafely({
            merchantId: input.merchantId,
            categorySlug: input.categorySlug,
          })
        : Promise.resolve(null),
    ]);

  const compareProducts =
    canLoadAuthority || (hasHubDefaults && canLoadHubPool)
      ? ((compareInventory?.products ?? []) as CategoryHubProduct[])
      : undefined;

  const hubPoolFetchFailed =
    shouldFetchHubPool &&
    (!hubCategoryData || hubCategoryData.productsQueryFailed);

  const hubProducts =
    hubCategoryData && !hubCategoryData.productsQueryFailed
      ? (hubCategoryData.products as RawDbProduct[])
      : hasHubDefaults &&
          isPageDataSufficient &&
          !input.categoryData.productsQueryFailed
        ? (input.categoryData.products.slice(
            0,
            COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT
          ) as RawDbProduct[])
        : hubPoolFetchFailed ||
            (input.isFiltered && hasHubDefaults && canLoadHubPool)
          ? []
          : undefined;

  return {
    guidePosts,
    brandAuthorityEntries,
    ...(hubProducts !== undefined ? { hubProducts } : {}),
    ...(compareProducts !== undefined ? { compareProducts } : {}),
  };
}
