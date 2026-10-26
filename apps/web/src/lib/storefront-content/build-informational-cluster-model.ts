import { formatCurrencyCompact } from '@/lib/currency';
import { buildCategorySupportLinks } from '@/lib/storefront-compare/build-commercial-support-links';
import { buildCuratedCompareSlugSet } from '@/lib/storefront-compare/compare-indexability-policy';
import { loadCompareCategoryInventorySafely } from '@/lib/storefront-compare/load-compare-category-inventory-safely';
import { loadMaintainedCompareRouteManifestSafely } from '@/lib/storefront-compare/load-maintained-compare-route-manifest-safely';
import { normalizeInferredBrands } from '@/lib/storefront-compare/normalize-inferred-brands';
import { resolveCanonicalBrandKey } from '@/lib/storefront-compare/resolve-canonical-brand-key';
import { loadCategoryScopedSemanticInventorySafely } from '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely';
import { buildClusterHubLinks } from './build-cluster-hub-links';
import type {
  BuildInformationalClusterModelInput,
  InformationalClusterCategoryData,
  InformationalClusterModel,
} from './content-cluster-types';
import { inferContentClusterContext } from './infer-content-cluster-context';
import { isAvailableProduct } from './is-available-product';
import { verifyPriceBandLinkAgainstDestination } from './verify-price-band-link-against-destination';

interface CategoryInventoryProduct {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
  category_slug?: string | null;
  category_slugs?: string[] | null;
  product_key_specs?: Record<string, unknown> | null;
  condition?: string | null;
  stock?: number | null;
  is_parent?: boolean | null;
  parent_product_id?: string | null;
  manage_stock?: boolean | null;
}

type OverrideCategoryProduct = NonNullable<
  InformationalClusterCategoryData['products']
>[number];

function resolveOverrideCategoryName(
  categoryData: InformationalClusterCategoryData,
  fallbackCategorySlug: string
) {
  return (
    categoryData.category?.name ||
    categoryData.fallbackName ||
    fallbackCategorySlug
  );
}

// The override products and the scoped semantic inventory share this already-
// normalized shape (slug/name/price/brand/category_slug/key-specs/condition/
// stock), so both map directly — no RawDbProduct branch needed now that the
// rich getCachedCategoryPageData payload no longer feeds this model.
function toCategoryInventoryProduct(
  categorySlug: string,
  product: OverrideCategoryProduct
): CategoryInventoryProduct {
  return {
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    price: product.price,
    category_slug: product.category_slug ?? categorySlug,
    category_slugs: product.category_slugs ?? null,
    product_key_specs: product.product_key_specs ?? null,
    condition: product.condition ?? null,
    stock: product.stock ?? null,
    is_parent: product.is_parent ?? null,
    parent_product_id: product.parent_product_id ?? null,
    manage_stock: product.manage_stock ?? null,
  };
}

// Featured picks link to PDPs, which resolve regardless of stock state;
// raw-pool availability is the intentional gate here (hub indexability
// thresholds are what destination verification protects).
function isInStock(product: CategoryInventoryProduct) {
  return isAvailableProduct(product);
}

function buildProductHref(storeUrl: string, product: CategoryInventoryProduct) {
  return product.category_slug
    ? `${storeUrl}/${product.category_slug}/${product.slug}`
    : `${storeUrl}/products/${product.slug}`;
}

function buildFeaturedProducts(
  storeUrl: string,
  categorySlug: string,
  inferredBrands: string[],
  products: CategoryInventoryProduct[],
  countryCode?: string | null
) {
  const inStockProducts = products.filter(isInStock);
  const normalizedBrands = normalizeInferredBrands(
    categorySlug,
    inferredBrands
  );
  const preferredProducts =
    normalizedBrands.length > 0
      ? inStockProducts.filter((product) =>
          normalizedBrands.includes(
            resolveCanonicalBrandKey(categorySlug, product.brand ?? '')
          )
        )
      : [];
  // When brands are inferred, featured picks stay on-brand; falling back
  // to the full pool would surface irrelevant child-category products.
  const selectedPool =
    normalizedBrands.length > 0 ? preferredProducts : inStockProducts;

  return selectedPool
    .slice()
    .sort(
      (left, right) =>
        left.price - right.price || left.slug.localeCompare(right.slug)
    )
    .slice(0, 2)
    .map((product) => ({
      href: buildProductHref(storeUrl, product),
      title: product.name,
      description: `${product.brand ?? 'Storefront pick'} • ${formatCurrencyCompact(product.price, countryCode || 'NG')}`,
    }));
}

export async function buildInformationalClusterModel(
  input: BuildInformationalClusterModelInput
): Promise<InformationalClusterModel | null> {
  const inferred = inferContentClusterContext(input.post);

  if (!inferred.categorySlug) {
    return null;
  }

  const categorySlug = inferred.categorySlug;
  let categoryName: string;
  let products: CategoryInventoryProduct[];

  if (input.categoryDataOverride) {
    const override = input.categoryDataOverride;
    if (override.isCollection) {
      return null;
    }
    categoryName = resolveOverrideCategoryName(override, categorySlug);
    products = (override.products ?? []).map((product) =>
      toCategoryInventoryProduct(categorySlug, product)
    );
  } else {
    // Repointed off the ~11-query getCachedCategoryPageData leg onto the single
    // category+children scoped semantic query. Degrades to an empty pool on a
    // transient failure — the cluster links are supplemental SEO content.
    const inventory = await loadCategoryScopedSemanticInventorySafely({
      merchantId: input.merchantId,
      categorySlug,
      storeSlug: input.merchantSlug,
      warningMessage: 'Failed to load informational cluster category inventory',
    });
    if (inventory.isCollection) {
      return null;
    }
    categoryName = inventory.categoryName;
    products = inventory.products.map((product) =>
      toCategoryInventoryProduct(categorySlug, product)
    );
  }

  const destinationVerified =
    input.categoryDataOverride?.destinationVerified === true;
  const [
    { brandHubLinks, familyHubLinks },
    approvedCompareSlugs,
    compareInventory,
  ] = await Promise.all([
    buildClusterHubLinks({
      post: input.post,
      inferredBrands: inferred.brands,
      categorySlug,
      categoryName,
      storeUrl: input.storeUrl,
      merchantId: input.merchantId,
      products,
      skipDestinationVerification: destinationVerified,
    }),
    destinationVerified ||
    input.categoryDataOverride ||
    inferred.brands.length === 0
      ? Promise.resolve(undefined)
      : loadMaintainedCompareRouteManifestSafely({
          merchantId: input.merchantId,
          categorySlug,
          storeSlug: input.merchantSlug,
          storeUrl: input.storeUrl,
        }),
    input.categoryDataOverride || inferred.brands.length === 0
      ? Promise.resolve(null)
      : loadCompareCategoryInventorySafely({
          merchantId: input.merchantId,
          categorySlug,
        }),
  ]);
  const commerceLinks = buildCategorySupportLinks({
    storeUrl: input.storeUrl,
    categorySlug,
    categoryName,
    products,
    inferredBrands: inferred.brands,
    approvedCompareSlugs,
    requireInferredBrandRelevance: true,
    compareProducts: input.categoryDataOverride
      ? undefined
      : (compareInventory?.products ?? []),
  });

  const verifiedCommerceLinks =
    input.categoryDataOverride?.destinationVerified === true
      ? commerceLinks
      : verifyPriceBandLinkAgainstDestination({
          categorySlug,
          links: commerceLinks,
          compareProducts: compareInventory?.products ?? null,
          curatedCompareSlugs: compareInventory
            ? buildCuratedCompareSlugSet({
                storeUrl: input.storeUrl,
                categorySlug,
                categoryName,
                products: compareInventory.products,
              })
            : undefined,
        });

  const combinedLinkCandidates = [
    ...brandHubLinks,
    ...familyHubLinks,
    ...verifiedCommerceLinks,
  ];

  const seenHrefs = new Set<string>();
  const finalCommerceLinks: Array<{ href: string; label: string }> = [];
  for (const link of combinedLinkCandidates) {
    if (!seenHrefs.has(link.href)) {
      seenHrefs.add(link.href);
      finalCommerceLinks.push(link);
    }
  }

  return {
    heading: `Continue shopping ${categoryName.toLowerCase()}`,
    primaryCategoryLink: {
      href: `${input.storeUrl}/${categorySlug}`,
      label: `Shop more ${categoryName.toLowerCase()}`,
    },
    commerceLinks: finalCommerceLinks.slice(0, 5),
    featuredProducts: buildFeaturedProducts(
      input.storeUrl,
      categorySlug,
      inferred.brands,
      products,
      input.countryCode
    ),
  };
}
