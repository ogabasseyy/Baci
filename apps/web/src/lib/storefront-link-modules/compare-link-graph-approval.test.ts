import { describe, expect, it, vi } from 'vitest';
import * as compareIndexabilityPolicy from '@/lib/storefront-compare/compare-indexability-policy';
import { buildCanonicalProductCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import {
  getSupplementalApprovalCandidateLimit,
  selectApprovedCompareGraphEntries,
} from './compare-link-graph-approval';

const deepProducts = Array.from({ length: 152 }, (_, index) => ({
  slug: `phone-${index}`,
  name: `Phone ${index}`,
  brand: `Brand ${index % 4}`,
  price: 250_000 + index,
  category_slug: 'smartphones',
  product_key_specs: {
    chipset: `Chip ${index}`,
    ram_gb: 4 + index,
    storage_gb: 64 + index,
  },
}));

describe('compare link graph approval', () => {
  it('keeps supplemental approval bounded', () => {
    expect(getSupplementalApprovalCandidateLimit(1)).toBe(16);
    expect(getSupplementalApprovalCandidateLimit(100)).toBe(150);
  });

  it('approves a deep candidate through bounded supplemental pair approval', () => {
    const candidate = {
      comparisonSlug: 'phone-150-vs-phone-151',
      productSlugs: ['phone-150', 'phone-151'] as [string, string],
      href: '/smartphones/compare/phone-150-vs-phone-151',
    };

    expect(
      selectApprovedCompareGraphEntries({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        policyProducts: deepProducts,
        candidateEntries: [candidate],
        maxLinks: 1,
      })
    ).toEqual([candidate]);
  });

  it('does not rebuild discovery for every prevalidated graph candidate', () => {
    const globallyCurated =
      compareIndexabilityPolicy.buildCuratedCompareSlugSet({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        products: deepProducts,
      });
    const candidates = deepProducts
      .flatMap((left, leftIndex) =>
        deepProducts.slice(leftIndex + 1).map((right) => {
          const comparisonSlug = buildCanonicalProductCompareSlug(
            left.slug,
            right.slug
          );
          return {
            comparisonSlug,
            productSlugs: [left.slug, right.slug] as [string, string],
            href: `/smartphones/compare/${comparisonSlug}`,
          };
        })
      )
      .filter((candidate) => !globallyCurated.has(candidate.comparisonSlug))
      .slice(0, 20);
    const policySpy = vi.spyOn(
      compareIndexabilityPolicy,
      'buildCuratedCompareSlugSet'
    );

    const result = selectApprovedCompareGraphEntries({
      storeUrl: 'https://ogabassey.com',
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      policyProducts: deepProducts,
      candidateEntries: candidates,
      candidateEntriesAreIndexable: true,
      maxLinks: 20,
    });

    expect(candidates).toHaveLength(20);
    expect(result).toEqual(candidates);
    // The candidates have already passed pair indexability and all are inside
    // the existing supplemental approval bound, so category-wide discovery is
    // not needed to produce this approved output.
    expect(policySpy).not.toHaveBeenCalled();
    policySpy.mockRestore();
  });

  it('does not approve entries when maxLinks is zero', () => {
    const candidate = {
      comparisonSlug: 'phone-150-vs-phone-151',
      productSlugs: ['phone-150', 'phone-151'] as [string, string],
      href: '/smartphones/compare/phone-150-vs-phone-151',
    };

    expect(
      selectApprovedCompareGraphEntries({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        policyProducts: deepProducts,
        candidateEntries: [candidate],
        maxLinks: 0,
      })
    ).toEqual([]);
  });
});
