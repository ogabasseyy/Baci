import { normalizeProduct } from '@/lib/normalize-product';
import type { RawDbProduct } from '@/lib/raw-db-product';
import { isRawDbProductRecord } from '@/lib/raw-db-product';
import { buildPriceBandCandidate } from '@/lib/storefront-compare/compare-eligibility';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';
import { loadCategoryPageDataSafely } from './load-category-page-data-safely';

export interface PriceBandLinkLike {
  href: string;
  label: string;
}

/**
 * Re-checks a best-under link against the price-band destination's own pool
 * (category page data normalized like loadPriceBandPage). The link survives
 * only when the destination candidate for that band is indexable.
 */
export async function verifyPriceBandLinkAgainstDestination(args: {
  merchantId: string;
  categorySlug: string;
  storeSlug: string;
  links: PriceBandLinkLike[];
}): Promise<PriceBandLinkLike[]> {
  const bandLinkIndex = args.links.findIndex((link) =>
    link.href.includes('/best-under/')
  );
  if (bandLinkIndex < 0) {
    return args.links;
  }
  const bandLink = args.links[bandLinkIndex];
  if (!bandLink) {
    return args.links;
  }
  const bandSlug = bandLink.href.slice(
    bandLink.href.indexOf('/best-under/') + '/best-under/'.length
  );
  const band = getCuratedPriceBands(args.categorySlug).find(
    (candidate) => candidate.slug === bandSlug
  );
  if (!band) {
    return args.links.filter((_, index) => index !== bandLinkIndex);
  }

  const categoryData = await loadCategoryPageDataSafely({
    merchantId: args.merchantId,
    categorySlug: args.categorySlug,
    storeSlug: args.storeSlug,
  });
  if (!categoryData || categoryData.isCollection) {
    return args.links.filter((_, index) => index !== bandLinkIndex);
  }

  const rawProducts = ((categoryData.products ?? []) as unknown[]).filter(
    (value): value is RawDbProduct => isRawDbProductRecord(value)
  );
  const candidate = buildPriceBandCandidate({
    categorySlug: args.categorySlug,
    band,
    products: rawProducts.map((product) => {
      const normalized = normalizeProduct(product, {
        preferredCategorySlug: args.categorySlug,
      });
      return {
        slug: normalized.slug,
        name: normalized.name,
        brand: normalized.brand,
        price: normalized.price,
      };
    }),
  });

  if (candidate.isIndexable) {
    return args.links;
  }
  return args.links.filter((_, index) => index !== bandLinkIndex);
}
