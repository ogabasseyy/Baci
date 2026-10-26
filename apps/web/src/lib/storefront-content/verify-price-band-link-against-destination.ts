import { buildPriceBandCandidate } from '@/lib/storefront-compare/compare-eligibility';
import { getCuratedPriceBands } from '@/lib/storefront-compare/price-band-taxonomy';

export interface PriceBandLinkLike {
  href: string;
  label: string;
}

export interface PriceBandProductLike {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
}

/**
 * Re-checks a best-under link against the price-band destination's candidate
 * rules using the already-loaded compare inventory (same category+children
 * scope and cap as the destination pool, shaped exactly like the
 * destination's candidate input: slug/name/brand/price only).
 */
export function verifyPriceBandLinkAgainstDestination(args: {
  categorySlug: string;
  links: PriceBandLinkLike[];
  compareProducts: PriceBandProductLike[] | null;
}): PriceBandLinkLike[] {
  const bandLinkIndex = args.links.findIndex((link) =>
    link.href.includes('/best-under/')
  );
  if (bandLinkIndex < 0) {
    return args.links;
  }
  const withoutBand = args.links.filter((_, index) => index !== bandLinkIndex);
  const bandLink = args.links[bandLinkIndex];
  if (!bandLink || !args.compareProducts) {
    return withoutBand;
  }
  const bandSlug = bandLink.href.slice(
    bandLink.href.indexOf('/best-under/') + '/best-under/'.length
  );
  const band = getCuratedPriceBands(args.categorySlug).find(
    (candidate) => candidate.slug === bandSlug
  );
  if (!band) {
    return withoutBand;
  }
  const candidate = buildPriceBandCandidate({
    categorySlug: args.categorySlug,
    band,
    products: args.compareProducts.map((product) => ({
      slug: product.slug,
      name: product.name,
      brand: product.brand ?? null,
      price: product.price,
    })),
  });
  return candidate.isIndexable ? args.links : withoutBand;
}
