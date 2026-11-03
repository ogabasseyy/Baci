import { buildCategorySupportLinks } from '@/lib/storefront-compare/build-commercial-support-links';
import { buildCuratedCompareSlugSet } from '@/lib/storefront-compare/compare-indexability-policy';
import { loadCompareCategoryInventorySafely } from '@/lib/storefront-compare/load-compare-category-inventory-safely';
import { loadMaintainedCompareRouteManifestSafely } from '@/lib/storefront-compare/load-maintained-compare-route-manifest-safely';
import { loadCategoryScopedSemanticInventorySafely } from '@/lib/storefront-product/load-category-scoped-semantic-inventory-safely';
import {
  buildClusterFeaturedProducts,
  type ClusterFeaturedInventoryProduct,
} from './build-cluster-featured-products';
import { buildClusterHubLinks } from './build-cluster-hub-links';
import type {
  BuildInformationalClusterModelInput,
  InformationalClusterCategoryData,
  InformationalClusterModel,
} from './content-cluster-types';
import { inferContentClusterContext } from './infer-content-cluster-context';
import { loadPriceBandDestinationPoolSafely } from './load-price-band-destination-pool-safely';
import { verifyPriceBandLinkAgainstDestination } from './verify-price-band-link-against-destination';

type CategoryInventoryProduct = ClusterFeaturedInventoryProduct;

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
    preferredPriceBandSlugs: inferred.matchedPriceBands,
    approvedCompareSlugs,
    requireInferredBrandRelevance: true,
    compareProducts: input.categoryDataOverride
      ? undefined
      : (compareInventory?.products ?? []),
  });

  const hasBandLink = commerceLinks.some((link) =>
    link.href.includes('/best-under/')
  );
  const bandDestinationPool =
    input.categoryDataOverride?.destinationVerified === true || !hasBandLink
      ? undefined
      : await loadPriceBandDestinationPoolSafely({
          merchantId: input.merchantId,
          merchantSlug: input.merchantSlug,
          categorySlug,
        });
  const verifiedCommerceLinks =
    input.categoryDataOverride?.destinationVerified === true
      ? commerceLinks
      : verifyPriceBandLinkAgainstDestination({
          categorySlug,
          links: commerceLinks,
          compareProducts: compareInventory?.products ?? null,
          // Bands verify against the destination's own category-page pool;
          // a failed load fails closed (empty pool drops band links).
          bandProducts:
            bandDestinationPool === undefined
              ? undefined
              : (bandDestinationPool ?? []),
          curatedCompareSlugs: compareInventory
            ? buildCuratedCompareSlugSet({
                storeUrl: input.storeUrl,
                categorySlug,
                categoryName,
                products: compareInventory.products,
              })
            : undefined,
          inferredBrands: inferred.brands,
        });

  // Reserve slots for verified commerce links before hub links fill
  // the final five-link slice; family hubs still cap at three.
  const brandLinkBudget = Math.max(
    0,
    Math.min(brandHubLinks.length, 5 - verifiedCommerceLinks.length)
  );
  const familyLinkBudget = Math.max(
    0,
    Math.min(3, 5 - brandLinkBudget - verifiedCommerceLinks.length)
  );
  const combinedLinkCandidates = [
    ...brandHubLinks.slice(0, brandLinkBudget),
    ...familyHubLinks.slice(0, familyLinkBudget),
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
    featuredProducts: buildClusterFeaturedProducts(
      input.storeUrl,
      categorySlug,
      inferred.brands,
      products,
      input.countryCode,
      `${input.post.title} ${input.post.slug}`
    ),
  };
}
