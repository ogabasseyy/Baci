import { describe, expect, it } from 'vitest';
import { GUIDE_SCOPE_KIND_MATRIX } from '@/schemas/blog-guide-metadata';
import { evaluateV2GuideCandidate } from './evaluate-v2-guide-candidate';
import {
  FIRST_RELEASE_GUIDE_COHORT,
  REVIEWED_COHORT_POSTS,
} from './first-release-guide-cohort';

describe('first-release-guide-cohort acceptance gate (§2.4 & §2.7)', () => {
  it('contains exactly 20 bounded distinct PDP entries', () => {
    expect(FIRST_RELEASE_GUIDE_COHORT.length).toBe(20);
    const productIds = new Set(
      FIRST_RELEASE_GUIDE_COHORT.map((p) => p.productId)
    );
    expect(productIds.size).toBe(20);
    const productSlugs = new Set(
      FIRST_RELEASE_GUIDE_COHORT.map((p) => p.productSlug)
    );
    expect(productSlugs.size).toBe(20);
  });

  it('contains reviewed positive posts within the 60-post cap', () => {
    const postCount = Object.keys(REVIEWED_COHORT_POSTS).length;
    expect(postCount).toBeGreaterThan(0);
    expect(postCount).toBeLessThanOrEqual(60);
  });

  it('validates canonical route aliases for both PDP route forms', () => {
    for (const entry of FIRST_RELEASE_GUIDE_COHORT) {
      expect(entry.canonicalRouteAliases).toEqual([
        `/${entry.categorySlug}/${entry.productSlug}`,
        `/products/${entry.productSlug}`,
      ]);
    }
  });

  it('verifies all reviewed cohort posts strictly adhere to GUIDE_SCOPE_KIND_MATRIX', () => {
    for (const [slug, post] of Object.entries(REVIEWED_COHORT_POSTS)) {
      expect(post.postSlug).toBe(slug);
      const allowedKinds = GUIDE_SCOPE_KIND_MATRIX[post.scope];
      expect(allowedKinds).toBeDefined();
      expect(
        (allowedKinds as readonly (string | null)[]).includes(post.kind)
      ).toBe(true);

      expect(post.contentHash).toBeTruthy();
      expect(post.revision).toBeTruthy();

      if (post.scope === 'product_specific') {
        expect(post.subjects?.some((s) => s.role === 'primary')).toBe(true);
      } else if (post.scope === 'model_comparison') {
        const compSubjects = (post.subjects ?? []).filter(
          (s) => s.role === 'comparison'
        );
        expect(compSubjects.length).toBeGreaterThanOrEqual(2);
      } else if (post.scope === 'troubleshooting') {
        expect(post.subjects?.some((s) => s.role === 'product_support')).toBe(
          true
        );
      } else if (post.scope === 'brand_family_guide') {
        expect(post.applicableBrands.length).toBeGreaterThanOrEqual(1);
        expect(post.subjects ?? []).toHaveLength(0);
      } else if (post.scope === 'category_guide') {
        expect(post.subjects ?? []).toHaveLength(0);
      }
    }
  });

  it('satisfies cohort coverage: every PDP has 1..3 verified guides or explicit empty section reason', () => {
    for (const entry of FIRST_RELEASE_GUIDE_COHORT) {
      if (entry.expectedGuides.length === 0) {
        expect(entry.emptySectionReason).toBeTruthy();
      } else {
        expect(entry.expectedGuides.length).toBeGreaterThanOrEqual(1);
        expect(entry.expectedGuides.length).toBeLessThanOrEqual(3);
        expect(entry.emptySectionReason).toBeNull();
      }
    }
  });

  it('proves zero wrong-product/brand regressions via evaluateV2GuideCandidate', () => {
    for (const entry of FIRST_RELEASE_GUIDE_COHORT) {
      const context = {
        productId: entry.productId,
        categorySlug: entry.categorySlug,
        brandKey: entry.brand,
      };

      // 1. All expected guides MUST evaluate to eligible with matching reason
      for (const expected of entry.expectedGuides) {
        const post = REVIEWED_COHORT_POSTS[expected.postSlug];
        expect(post).toBeDefined();

        const candidate = {
          slug: post.postSlug,
          title: post.title,
          cluster_category_slug: post.clusterCategorySlug,
          guide_scope: post.scope,
          guide_kind: post.kind,
          metadata_status: 'verified',
          metadata_source_revision: post.revision,
          metadata_contract_version: 2,
          applicable_brands: post.applicableBrands,
          subjects: post.subjects?.map((s) => ({
            productId: s.productId,
            subjectRole: s.role,
          })),
        };

        const result = evaluateV2GuideCandidate(candidate, context);
        expect(result.eligible).toBe(true);
        expect(result.reason).toBe(expected.eligibilityReason);
      }

      // 2. All rejected fixtures MUST evaluate to ineligible
      for (const rejected of entry.rejectedFixtures) {
        const post = REVIEWED_COHORT_POSTS[rejected.postSlug];
        expect(post).toBeDefined();

        const candidate = {
          slug: post.postSlug,
          title: post.title,
          cluster_category_slug: post.clusterCategorySlug,
          guide_scope: post.scope,
          guide_kind: post.kind,
          metadata_status: 'verified',
          metadata_source_revision: post.revision,
          metadata_contract_version: 2,
          applicable_brands: post.applicableBrands,
          subjects: post.subjects?.map((s) => ({
            productId: s.productId,
            subjectRole: s.role,
          })),
        };

        const result = evaluateV2GuideCandidate(candidate, context);
        expect(result.eligible).toBe(false);
      }

      // 3. Bounded cohort safety invariant: no non-expected reviewed post evaluates as eligible
      const expectedSlugs = new Set(
        entry.expectedGuides.map((g) => g.postSlug)
      );
      for (const [slug, post] of Object.entries(REVIEWED_COHORT_POSTS)) {
        if (expectedSlugs.has(slug)) continue;
        const candidate = {
          slug: post.postSlug,
          title: post.title,
          cluster_category_slug: post.clusterCategorySlug,
          guide_scope: post.scope,
          guide_kind: post.kind,
          metadata_status: 'verified',
          metadata_source_revision: post.revision,
          metadata_contract_version: 2,
          applicable_brands: post.applicableBrands,
          subjects: post.subjects?.map((s) => ({
            productId: s.productId,
            subjectRole: s.role,
          })),
        };
        const result = evaluateV2GuideCandidate(candidate, context);
        expect(
          result.eligible,
          `Unintended match: post "${slug}" evaluated as eligible for PDP "${entry.productId}" (${entry.productSlug})`
        ).toBe(false);
      }
    }
  });
});
