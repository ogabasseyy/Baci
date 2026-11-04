import { describe, expect, it } from 'vitest';
import {
  evaluateV2GuideCandidate,
  type V2GuideCandidate,
} from './evaluate-v2-guide-candidate';

describe('evaluateV2GuideCandidate - rejection and edge cases', () => {
  const baseGuide: V2GuideCandidate = {
    slug: 'sample-guide',
    title: 'Sample Guide',
    category: 'Smartphones',
    cluster_category_slug: 'smartphones',
    guide_scope: 'category_guide',
    guide_kind: 'buyer-guide',
    metadata_status: 'verified',
    metadata_source_revision: 'rev-base-1',
    metadata_contract_version: 2,
    applicable_brands: [],
  };

  it('rejects stale status', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_status: 'stale' },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects unverified status', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_status: 'unverified' },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects general news scope', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, guide_scope: 'general_news', guide_kind: null },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects metadata_contract_version below 2 or missing', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_contract_version: 1 },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);

    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_contract_version: undefined },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);

    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_contract_version: null },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects missing or whitespace metadata_source_revision', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_source_revision: undefined },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);

    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_source_revision: null },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);

    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_source_revision: '   ' },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects null guide_kind', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, guide_kind: null },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('fails closed on missing or null metadata_status', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_status: null },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);

    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, metadata_status: undefined },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects placeholder brand keys in applicable_brands', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, applicable_brands: ['gaming'] },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects free-text category fallback when cluster_category_slug is missing', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, cluster_category_slug: null, category: 'Smartphones' },
        { categorySlug: 'smartphones', brandKey: 'Samsung' }
      ).eligible
    ).toBe(false);
  });

  it('rejects completely unlinked categories', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, cluster_category_slug: 'shoes' },
        {
          categorySlug: 'smartphones',
          brandKey: 'Samsung',
          validCategorySlugs: ['accessories'],
        }
      ).eligible
    ).toBe(false);
  });

  it('honors secondary category slug membership', () => {
    expect(
      evaluateV2GuideCandidate(
        { ...baseGuide, cluster_category_slug: 'accessories' },
        {
          categorySlug: 'smartphones',
          brandKey: 'Samsung',
          validCategorySlugs: ['accessories'],
        }
      ).eligible
    ).toBe(true);
  });

  it('rejects blind eligibility_reason without matching subject', () => {
    expect(
      evaluateV2GuideCandidate(
        {
          ...baseGuide,
          guide_scope: 'product_specific',
          subjects: [],
          eligibility_reason: 'subject_primary',
        },
        {
          productId: 'prod-target',
          categorySlug: 'smartphones',
          brandKey: 'Samsung',
        }
      ).eligible
    ).toBe(false);
  });
});
