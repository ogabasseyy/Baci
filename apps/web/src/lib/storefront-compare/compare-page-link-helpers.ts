import {
  buildCompareLinkGraph,
  type CompareLinkGraphEntry,
  type CompareLinkGraphProduct,
} from '@/lib/storefront-link-modules/compare-link-graph';
import {
  COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT,
  getCachedCompareCategoryInventory,
} from './get-cached-compare-category-inventory';

// Preserve the former semantic-overlay bound while sourcing it from the
// category snapshot that the compare core already loaded. This must remain at
// or below COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT so every emitted graph URL
// can resolve from the same authoritative compare inventory.
export const COMPARE_GRAPH_PRODUCT_LIMIT = Math.min(
  300,
  COMPARE_CATEGORY_INVENTORY_PRODUCT_LIMIT
);

export async function loadCompareGraphProducts(input: {
  categorySlug: string;
  merchantId: string;
  storeSlug: string;
}) {
  try {
    // getCachedComparePageModel loads this exact category snapshot before the
    // overlay runs. Re-reading the same Cache Components key reuses that local
    // snapshot instead of issuing the former second, ~0.5MB Supabase request.
    const inventory = await getCachedCompareCategoryInventory(
      input.merchantId,
      input.categorySlug
    );

    return {
      failed: false,
      products: inventory.products
        .filter((product) => product.category_slug === input.categorySlug)
        .slice(0, COMPARE_GRAPH_PRODUCT_LIMIT),
    };
  } catch (error) {
    console.warn('Failed to load bounded compare graph inventory', {
      categorySlug: input.categorySlug,
      merchantId: input.merchantId,
      error,
    });
    return { failed: true, products: [] };
  }
}

export function includeClickedCompareProducts(input: {
  products: CompareLinkGraphProduct[];
  clickedProducts: Array<CompareLinkGraphProduct | undefined>;
}) {
  const productSlugs = new Set(
    input.products
      .map((product) => product.slug?.trim())
      .filter((slug): slug is string => Boolean(slug))
  );
  const clickedProducts = input.clickedProducts.filter(
    (product): product is CompareLinkGraphProduct =>
      Boolean(product?.slug && !productSlugs.has(product.slug))
  );

  return clickedProducts.length > 0
    ? [...input.products, ...clickedProducts]
    : input.products;
}

export function dedupeCompareLinks(links: CompareLinkGraphEntry[]) {
  return links.filter(
    (link, index) =>
      links.findIndex((candidate) => candidate.href === link.href) === index
  );
}

export function buildRelatedCompareLinks(input: {
  storeUrl: string;
  categorySlug: string;
  categoryName: string;
  products: CompareLinkGraphProduct[];
  leftProductSlug: string;
  rightProductSlug: string;
  currentComparisonSlug: string;
}) {
  const leftLinks = buildCompareLinkGraph({
    storeUrl: input.storeUrl,
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    products: input.products,
    productsAreKnownActive: true,
    anchorProductSlug: input.leftProductSlug,
    currentComparisonSlug: input.currentComparisonSlug,
    maxLinks: 3,
  });
  const rightLinks = buildCompareLinkGraph({
    storeUrl: input.storeUrl,
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    products: input.products,
    productsAreKnownActive: true,
    anchorProductSlug: input.rightProductSlug,
    currentComparisonSlug: input.currentComparisonSlug,
    maxLinks: 3,
  });

  return dedupeCompareLinks([...leftLinks, ...rightLinks]).slice(0, 6);
}
