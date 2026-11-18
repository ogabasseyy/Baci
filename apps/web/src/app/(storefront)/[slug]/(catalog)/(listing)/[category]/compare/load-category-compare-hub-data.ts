import {
  getCachedCategories,
  getMerchantByIdentifier,
} from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import {
  buildCategoryCompareHubProductGroups,
  findVisibleCompareHubCategory,
} from './category-compare-hub-links';

export async function loadCategoryCompareHubData(input: {
  merchantSlug: string;
  categorySlug: string;
}) {
  const merchant = await getMerchantByIdentifier(input.merchantSlug);

  if (!merchant) {
    return null;
  }

  const requestedCategorySlug = canonicalizeCategorySlug(input.categorySlug);

  if (!requestedCategorySlug) {
    return null;
  }

  const categories = await getCachedCategories(merchant.id);
  const category = findVisibleCompareHubCategory(
    categories,
    requestedCategorySlug
  );

  if (!category?.name) {
    return null;
  }

  const productGroups = await buildCategoryCompareHubProductGroups({
    categories,
    category,
    merchantId: merchant.id,
  });

  return {
    categoryName: category.name,
    categorySlug: requestedCategorySlug,
    merchant,
    productGroups: productGroups.map(
      ({ categoryName, categorySlug, products }) => ({
        categoryName,
        categorySlug,
        products,
      })
    ),
    products: productGroups.flatMap((group) => group.products),
    inventoryDegraded: productGroups.some((group) => group.inventoryLoadFailed),
    storeUrl: buildStoreUrl(merchant),
  };
}
