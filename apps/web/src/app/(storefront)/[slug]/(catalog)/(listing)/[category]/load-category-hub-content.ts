import { CONTENT_CLUSTER_SUPPORT } from '@/config/storefront-content-clusters';
import {
  type CachedCategoryPageData,
  getCachedCategoryPageData,
} from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import { getCachedBrandAuthorityEntries } from '@/lib/storefront-category/get-cached-brand-authority-entries';
import { COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT } from '@/lib/storefront-compare/price-band-taxonomy';
import type { SupportedClusterCategory } from '@/lib/storefront-content/content-cluster-types';
import { loadPublishedClusterPostsSafely } from '@/lib/storefront-content/load-published-cluster-posts-safely';

export async function loadCategoryHubContent(input: {
  merchantId: string;
  categorySlug: string;
  categoryData: CachedCategoryPageData;
  storeSlug?: string;
}) {
  const supportedCategory =
    input.categorySlug in CONTENT_CLUSTER_SUPPORT
      ? (input.categorySlug as SupportedClusterCategory)
      : null;
  const canLoadAuthority =
    !input.categoryData.isCollection &&
    !input.categoryData.isInactiveCategory &&
    Boolean(input.categoryData.category?.id);

  const [guidePosts, brandAuthorityEntries, hubCategoryData] =
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
      canLoadAuthority && input.storeSlug
        ? getCachedCategoryPageData(
            input.merchantId,
            input.categorySlug,
            input.storeSlug,
            0,
            COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

  const hubProducts =
    hubCategoryData && !hubCategoryData.productsQueryFailed
      ? (hubCategoryData.products as RawDbProduct[])
      : undefined;

  return {
    guidePosts,
    brandAuthorityEntries,
    ...(hubProducts ? { hubProducts } : {}),
  };
}
