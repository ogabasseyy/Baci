import {
  type BuildCompareLinkGraphInput,
  buildCompareLinkGraph,
  isActiveCompareProduct,
} from '@/lib/storefront-link-modules/compare-link-graph';
import { buildCategoryCompareGraphSlugSet } from '@/lib/storefront-link-modules/compare-maintained-slug';
import { PDP_SEMANTIC_INVENTORY_LIMIT } from '@/lib/storefront-product/pdp-semantic-inventory-limit';
import { buildProductCompareCandidate } from './compare-eligibility';
import { parseCompareSlug } from './compare-slugs';

const ANCHORED_COMPARE_ROUTE_LIMIT = 8;

/**
 * Builds the complete product-comparison route allow-list for one bounded
 * category inventory snapshot. Alongside discovery and category-graph routes,
 * include the bounded anchored graph emissions used by PDP compare links.
 */
export function getMaintainedCompareRouteManifest(
  input: BuildCompareLinkGraphInput & {
    curatedSlugs: ReadonlySet<string>;
  }
): ReadonlySet<string> {
  const activeProducts = input.products.filter((product) =>
    isActiveCompareProduct(product, input.productsAreKnownActive ?? false)
  );
  const productsBySlug = new Map(
    activeProducts.map((product) => [product.slug?.trim(), product])
  );
  const slugs = new Set<string>();

  for (const slug of input.curatedSlugs) {
    const parsed = parseCompareSlug(slug);
    if (!parsed) continue;
    const leftProduct = productsBySlug.get(parsed.leftKey);
    const rightProduct = productsBySlug.get(parsed.rightKey);
    if (
      leftProduct &&
      rightProduct &&
      buildProductCompareCandidate({
        categorySlug: input.categorySlug,
        leftProduct: { ...leftProduct, slug: parsed.leftKey },
        rightProduct: { ...rightProduct, slug: parsed.rightKey },
      }).isIndexable
    )
      slugs.add(parsed.canonicalSlug);
  }

  for (const slug of buildCategoryCompareGraphSlugSet(input)) {
    slugs.add(slug);
  }

  for (const anchorProduct of activeProducts) {
    const anchorProductSlug = anchorProduct.slug?.trim();
    if (!anchorProductSlug) {
      continue;
    }

    // Match the exact newest-first inventory window the PDP enrichment RPC
    // returns: the current product plus the newest 48 other active products.
    const pdpProducts = [
      anchorProduct,
      ...activeProducts
        .filter((product) => product.slug?.trim() !== anchorProductSlug)
        .slice(0, PDP_SEMANTIC_INVENTORY_LIMIT),
    ];

    for (const entry of buildCompareLinkGraph({
      ...input,
      anchorProductSlug,
      currentComparisonSlug: undefined,
      maxLinks: ANCHORED_COMPARE_ROUTE_LIMIT,
      products: pdpProducts,
      productsAreKnownActive: true,
    })) {
      slugs.add(entry.comparisonSlug);
    }
  }

  return slugs;
}
