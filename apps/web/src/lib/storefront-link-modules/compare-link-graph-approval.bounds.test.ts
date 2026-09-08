import { afterEach, describe, expect, it, vi } from 'vitest';
import * as compareIndexabilityPolicy from '@/lib/storefront-compare/compare-indexability-policy';
import { buildCanonicalProductCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import { selectApprovedCompareGraphEntries } from '@/lib/storefront-link-modules/compare-link-graph-approval';

function candidate(leftSlug: string) {
  return {
    comparisonSlug: buildCanonicalProductCompareSlug(leftSlug, 'right'),
    productSlugs: [leftSlug, 'right'] as [string, string],
  };
}

const input = {
  storeUrl: 'https://store.example',
  categorySlug: 'phones',
  categoryName: 'Phones',
  policyProducts: [],
};

describe('lazy comparison approval boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('still requires curated membership for prevalidated overflow candidates', () => {
    // Arrange: the existing supplemental bound is 150, regardless of maxLinks.
    const withinBound = Array.from({ length: 150 }, (_, index) =>
      candidate(`trusted-${index}`)
    );
    const rejectedOverflow = candidate('overflow-not-curated');
    const curatedOverflow = candidate('overflow-curated');
    const curate = vi
      .spyOn(compareIndexabilityPolicy, 'buildCuratedCompareSlugSet')
      .mockReturnValue(new Set([curatedOverflow.comparisonSlug]));

    // Act: crossing the bound must trigger the original curated policy.
    const result = selectApprovedCompareGraphEntries({
      ...input,
      candidateEntries: [...withinBound, rejectedOverflow, curatedOverflow],
      candidateEntriesAreIndexable: true,
      maxLinks: 152,
    });

    // Assert: the optimization never expands approval past that bound.
    expect(result).toEqual([...withinBound, curatedOverflow]);
    expect(curate).toHaveBeenCalledTimes(1);
  });

  it('does not auto-approve an unvalidated candidate inside the bound', () => {
    // Arrange: neither category-wide nor supplemental curation accepts it.
    const curate = vi
      .spyOn(compareIndexabilityPolicy, 'buildCuratedCompareSlugSet')
      .mockReturnValue(new Set());

    // Act: omit the prevalidation flag, as an untrusted caller would.
    const result = selectApprovedCompareGraphEntries({
      ...input,
      candidateEntries: [candidate('unvalidated')],
      maxLinks: 1,
    });

    // Assert: both original checks still run and the candidate is rejected.
    expect(result).toEqual([]);
    expect(curate).toHaveBeenCalledTimes(2);
  });

  it('does no curated work when there are no candidates', () => {
    // Arrange
    const curate = vi.spyOn(
      compareIndexabilityPolicy,
      'buildCuratedCompareSlugSet'
    );

    // Act
    const result = selectApprovedCompareGraphEntries({
      ...input,
      candidateEntries: [],
      candidateEntriesAreIndexable: true,
      maxLinks: 3,
    });

    // Assert
    expect(result).toEqual([]);
    expect(curate).not.toHaveBeenCalled();
  });
});
