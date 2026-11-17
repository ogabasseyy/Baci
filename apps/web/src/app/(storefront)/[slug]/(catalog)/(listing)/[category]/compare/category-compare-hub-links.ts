import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import { buildCompareLinkGraph } from '@/lib/storefront-link-modules/compare-link-graph';
import { getCachedProductSemanticInventory } from '@/lib/storefront-product/get-cached-product-semantic-inventory';
import type { ProductSemanticCandidate } from '@/lib/storefront-product/product-semantic-types';
import type { loadCategoryCompareHubData } from './load-category-compare-hub-data';

export type CategoryCompareHubData = NonNullable<
  Awaited<ReturnType<typeof loadCategoryCompareHubData>>
>;

export interface CompareHubCategoryEntry {
  id: string;
  name?: string | null;
  slug?: string | null;
  is_active?: boolean | null;
  parent_id?: string | null;
}

export interface CategoryCompareHubProductGroup {
  categoryName: string;
  categorySlug: string;
  products: ProductSemanticCandidate[];
  inventoryLoadFailed: boolean;
}

export function findVisibleCompareHubCategory<
  T extends CompareHubCategoryEntry,
>(categories: readonly T[], requestedCategorySlug: string): T | undefined {
  return categories.find(
    (entry) =>
      entry.is_active !== false &&
      canonicalizeCategorySlug(entry.slug) === requestedCategorySlug
  );
}

export function buildCategoryCompareHubProductGroups(input: {
  categories: readonly CompareHubCategoryEntry[];
  category: CompareHubCategoryEntry;
  merchantId: string;
  signal?: AbortSignal;
}): Promise<CategoryCompareHubProductGroup[]> {
  const scopedCategories = [
    input.category,
    ...input.categories.filter(
      (entry) =>
        entry.parent_id === input.category.id && entry.is_active === true
    ),
  ];
  const seenSlugs = new Set<string>();

  return Promise.all(
    scopedCategories.flatMap((category) => {
      const categorySlug = canonicalizeCategorySlug(category.slug);
      const categoryName = category.name?.trim();
      if (!categorySlug || !categoryName || seenSlugs.has(categorySlug)) {
        return [];
      }
      seenSlugs.add(categorySlug);

      const inventoryPromise = input.signal
        ? getCachedProductSemanticInventory(
            input.merchantId,
            categorySlug,
            input.signal
          )
        : getCachedProductSemanticInventory(input.merchantId, categorySlug);

      return [
        inventoryPromise.then(
          (products) => ({
            categoryName,
            categorySlug,
            products,
            inventoryLoadFailed: false,
          }),
          (error: unknown) => {
            console.warn('Failed to load category compare hub inventory', {
              categorySlug,
              merchantId: input.merchantId,
              error,
            });
            return {
              categoryName,
              categorySlug,
              products: [],
              inventoryLoadFailed: true,
            };
          }
        ),
      ];
    })
  );
}

const CATEGORY_COMPARE_HUB_LINK_LIMIT = 48;
const CATEGORY_COMPARE_HUB_MIN_LINKS_PER_GROUP = 6;

/**
 * Builds the hub's compare-link list from loaded hub data. Extracted from the
 * hub page so the page, the thin-hub 404 guard, and the proxy's empty-hub
 * preflight (via /api/internal/compare-hub-status) all share ONE definition of
 * "which links does this hub have" — the hard-404 preflight must never judge
 * emptiness by a different criterion than the page that renders (or 404s) it.
 */
export type CategoryCompareHubLinksInput = Pick<
  CategoryCompareHubData,
  'categoryName' | 'categorySlug' | 'productGroups' | 'products' | 'storeUrl'
>;

export function buildCategoryCompareHubLinks(
  data: CategoryCompareHubLinksInput
) {
  const productGroups =
    data.productGroups?.length > 0
      ? data.productGroups
      : [
          {
            categoryName: data.categoryName,
            categorySlug: data.categorySlug,
            products: data.products,
          },
        ];
  const linksPerGroup = Math.max(
    CATEGORY_COMPARE_HUB_MIN_LINKS_PER_GROUP,
    Math.ceil(CATEGORY_COMPARE_HUB_LINK_LIMIT / productGroups.length)
  );

  return productGroups
    .flatMap((group) =>
      buildCompareLinkGraph({
        storeUrl: data.storeUrl,
        categorySlug: group.categorySlug,
        categoryName: group.categoryName,
        products: group.products,
        productsAreKnownActive: true,
        maxLinks: linksPerGroup,
      })
    )
    .slice(0, CATEGORY_COMPARE_HUB_LINK_LIMIT);
}
