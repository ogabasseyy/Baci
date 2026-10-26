import { buildCategoryPriceBandCandidates } from '@/lib/storefront-compare/build-commercial-support-links';
import {
  buildBrandCompareCandidate,
  buildProductCompareCandidate,
} from '@/lib/storefront-compare/compare-eligibility';
import { isCuratedCompareSlug } from '@/lib/storefront-compare/compare-indexability-policy';
import { parseCompareSlug } from '@/lib/storefront-compare/compare-slugs';

export interface PriceBandLinkLike {
  href: string;
  label: string;
}

export interface PriceBandProductLike {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
  category_slug?: string | null;
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
  /** Normalized scoped pool the destination price-band page derives from. */
  bandProducts?: PriceBandProductLike[] | null;
  curatedCompareSlugs?: ReadonlySet<string>;
}): PriceBandLinkLike[] {
  const brandCandidate = args.compareProducts
    ? buildBrandCompareCandidate({
        categorySlug: args.categorySlug,
        products: args.compareProducts,
      })
    : null;
  const bandPool = args.bandProducts ?? args.compareProducts;
  const indexableBandSlugs = new Set(
    bandPool
      ? buildCategoryPriceBandCandidates(args.categorySlug, bandPool)
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
        // The destination brand page also requires the slug to be in its
        // curated set; when the caller supplies that set, enforce it.
        return args.curatedCompareSlugs
          ? isCuratedCompareSlug(compareSlug, args.curatedCompareSlugs)
          : true;
      }
      // Product-compare links survive only when the destination pool's
      // own candidate for the decoded pair is indexable.
      const parsed = parseCompareSlug(compareSlug);
      if (!parsed || !args.compareProducts) return false;
      // Product pairs are not held to the discovery curated set: the
      // destination also accepts maintained-route pairs outside it.
      const leftProduct = args.compareProducts.find(
        (product) => product.slug === parsed.leftKey
      );
      const rightProduct = args.compareProducts.find(
        (product) => product.slug === parsed.rightKey
      );
      if (!leftProduct || !rightProduct) return false;
      return buildProductCompareCandidate({
        categorySlug: args.categorySlug,
        leftProduct,
        rightProduct,
      }).isIndexable;
    }
    // Fail closed: only best-under and compare shapes are verifiable here.
    return false;
  });
}
