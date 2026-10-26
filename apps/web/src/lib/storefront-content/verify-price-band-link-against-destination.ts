import { buildCategoryPriceBandCandidates } from '@/lib/storefront-compare/build-commercial-support-links';
import { buildBrandCompareCandidate } from '@/lib/storefront-compare/compare-eligibility';

export interface PriceBandLinkLike {
  href: string;
  label: string;
}

export interface PriceBandProductLike {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
  product_key_specs?: Record<string, unknown> | null;
}

function segmentAfter(href: string, marker: string): string | null {
  const index = href.indexOf(marker);
  if (index < 0) return null;
  const rest = href.slice(index + marker.length);
  const segment = rest.split(/[/?#]/)[0];
  return segment ? segment : null;
}

/**
 * Re-checks best-under and brand-compare links against destination
 * candidates derived from the already-loaded compare inventory (same
 * category+children scope and cap as the destination pools). With no
 * compare inventory, both link kinds are dropped (fail closed).
 */
export function verifyPriceBandLinkAgainstDestination(args: {
  categorySlug: string;
  links: PriceBandLinkLike[];
  compareProducts: PriceBandProductLike[] | null;
}): PriceBandLinkLike[] {
  const brandCandidate = args.compareProducts
    ? buildBrandCompareCandidate({
        categorySlug: args.categorySlug,
        products: args.compareProducts,
      })
    : null;
  const indexableBandSlugs = new Set(
    args.compareProducts
      ? buildCategoryPriceBandCandidates(
          args.categorySlug,
          args.compareProducts
        )
          .filter((candidate) => candidate.isIndexable)
          .map((candidate) => candidate.band.slug)
      : []
  );

  return args.links.filter((link) => {
    const bandSlug = segmentAfter(link.href, '/best-under/');
    if (bandSlug !== null) {
      return indexableBandSlugs.has(bandSlug);
    }
    const compareSlug = segmentAfter(link.href, '/compare/');
    if (compareSlug?.includes('-vs-')) {
      // The destination brand page is kept only for its own indexable
      // top-two candidate; every other brand-style slug is dropped.
      if (
        brandCandidate?.isIndexable &&
        compareSlug === brandCandidate.canonicalSlug
      ) {
        return true;
      }
      // Product-compare links are gated by the maintained-route manifest;
      // they survive only when both sides are product slugs in the pool.
      const [left, right] = compareSlug.split('-vs-');
      const productSlugs = new Set(
        (args.compareProducts ?? []).map((product) => product.slug)
      );
      return Boolean(
        left && right && productSlugs.has(left) && productSlugs.has(right)
      );
    }
    return true;
  });
}
