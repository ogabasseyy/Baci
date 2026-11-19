import { isNonBrandPlaceholderKey } from '@/schemas/blog-guide-metadata';

export interface V2GuideCandidateSubject {
  productId: string;
  subjectRole: 'primary' | 'comparison' | 'product_support';
  sourceRevision?: string | null;
}

export interface V2GuideCandidate {
  id?: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  category?: string | null;
  tags?: string[] | null;
  keywords?: string[] | null;
  featured_image_url?: string | null;
  published_at?: string | null;
  reading_time_minutes?: number | null;
  cluster_category_id?: string | null;
  cluster_category_slug?: string | null;
  guide_scope?: string | null;
  guide_kind?: string | null;
  applicable_brands?: string[] | null;
  metadata_status?: string | null;
  metadata_source_revision?: string | null;
  metadata_contract_version?: number | null;
  eligibility_reason?: string | null;
  subjects?: V2GuideCandidateSubject[];
}

export interface EvaluateV2GuideCandidateContext {
  productId?: string | null;
  categorySlug?: string | null;
  categoryId?: string | null;
  brandKey?: string | null;
  validCategoryIds?: string[];
  validCategorySlugs?: string[];
}

export interface EvaluateV2GuideCandidateResult {
  eligible: boolean;
  reason?:
    | 'subject_primary'
    | 'subject_comparison'
    | 'subject_product_support'
    | 'brand_family_guide'
    | 'category_guide';
  exclusionReason?: string;
}

function normalizeSlug(str: string | null | undefined): string {
  return (str ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Validates a v2 guide candidate against a target PDP context enforcing the
 * plan §2.5 ALLOW rules:
 *
 * Path A: Explicit current subject targeting this product:
 *   - primary + product_specific + buyer-guide
 *   - comparison + model_comparison + decision-support
 *   - product_support + troubleshooting + troubleshooting
 *
 * Path B: Verified general category_guide or brand_family_guide:
 *   - buyer-guide | best-in-nigeria
 *   - exact category match (validated cluster category, never free-text display category)
 *   - declared brand match (or brand-neutral for category_guide)
 *   - no family restriction
 *
 * Never defaults null guideKind to 'buyer-guide'.
 * Does NOT require legacy CONTENT_CLUSTER_SUPPORT allowlist.
 */
export function evaluateV2GuideCandidate(
  candidate: V2GuideCandidate,
  context: EvaluateV2GuideCandidateContext
): EvaluateV2GuideCandidateResult {
  // 1. Fail closed on missing/null/unverified metadata status
  if (candidate.metadata_status !== 'verified') {
    return {
      eligible: false,
      exclusionReason: `metadata_status is "${candidate.metadata_status ?? 'missing'}", requires verified`,
    };
  }

  // 2. Reject missing or under-versioned metadata contract version (requires >= 2)
  if (
    typeof candidate.metadata_contract_version !== 'number' ||
    candidate.metadata_contract_version < 2
  ) {
    return {
      eligible: false,
      exclusionReason: `metadata_contract_version "${candidate.metadata_contract_version ?? 'missing'}" is below required contract version 2`,
    };
  }

  // 3. Require non-empty metadata_source_revision for verified candidates
  if (
    typeof candidate.metadata_source_revision !== 'string' ||
    !candidate.metadata_source_revision.trim()
  ) {
    return {
      eligible: false,
      exclusionReason:
        'metadata_source_revision is required for verified guides',
    };
  }

  // 3. Disallow general_news and missing kind
  if (candidate.guide_scope === 'general_news') {
    return {
      eligible: false,
      exclusionReason: 'general_news cannot be a guide recommendation',
    };
  }

  if (!candidate.guide_kind) {
    return {
      eligible: false,
      exclusionReason: 'missing guide_kind (never default null to buyer-guide)',
    };
  }

  // 3. Reject placeholder brand keys
  if (candidate.applicable_brands?.some(isNonBrandPlaceholderKey)) {
    return {
      eligible: false,
      exclusionReason: 'applicable_brands contains placeholder brand key',
    };
  }

  // 4. Path A: Explicit subject match targeting this product
  if (context.productId) {
    if (candidate.subjects && candidate.subjects.length > 0) {
      if (
        candidate.guide_scope === 'product_specific' &&
        candidate.guide_kind === 'buyer-guide'
      ) {
        const hasPrimary = candidate.subjects.some(
          (s) =>
            s.productId === context.productId && s.subjectRole === 'primary'
        );
        if (hasPrimary) return { eligible: true, reason: 'subject_primary' };
      } else if (
        candidate.guide_scope === 'model_comparison' &&
        candidate.guide_kind === 'decision-support'
      ) {
        const hasComparison = candidate.subjects.some(
          (s) =>
            s.productId === context.productId && s.subjectRole === 'comparison'
        );
        if (hasComparison)
          return { eligible: true, reason: 'subject_comparison' };
      } else if (
        candidate.guide_scope === 'troubleshooting' &&
        candidate.guide_kind === 'troubleshooting'
      ) {
        const hasSupport = candidate.subjects.some(
          (s) =>
            s.productId === context.productId &&
            s.subjectRole === 'product_support'
        );
        if (hasSupport)
          return { eligible: true, reason: 'subject_product_support' };
      }
    }
  }

  // If candidate is product-specific, comparison, or troubleshooting, it CANNOT qualify without an explicit subject match
  if (
    candidate.guide_scope === 'product_specific' ||
    candidate.guide_scope === 'model_comparison' ||
    candidate.guide_scope === 'troubleshooting'
  ) {
    return {
      eligible: false,
      exclusionReason: `guide_scope "${candidate.guide_scope}" requires explicit subject match targeting this product`,
    };
  }

  // 5. Path B: Verified general category_guide or brand_family_guide
  if (
    candidate.guide_scope === 'category_guide' ||
    candidate.guide_scope === 'brand_family_guide'
  ) {
    if (
      candidate.guide_kind !== 'buyer-guide' &&
      candidate.guide_kind !== 'best-in-nigeria'
    ) {
      return {
        eligible: false,
        exclusionReason: `guide_kind "${candidate.guide_kind}" not permitted for general guide`,
      };
    }

    // Exact canonical category match (§2.5: supports primary and secondary memberships)
    let categoryMatches = false;
    if (context.categoryId && candidate.cluster_category_id) {
      categoryMatches =
        context.categoryId === candidate.cluster_category_id ||
        Boolean(
          context.validCategoryIds?.includes(candidate.cluster_category_id)
        );
    }
    if (!categoryMatches && candidate.cluster_category_slug) {
      const candSlug = normalizeSlug(candidate.cluster_category_slug);
      const targetSlug = normalizeSlug(context.categorySlug);
      const validSlugs = (context.validCategorySlugs ?? []).map(normalizeSlug);
      categoryMatches = Boolean(
        candSlug && (candSlug === targetSlug || validSlugs.includes(candSlug))
      );
    }

    if (!categoryMatches) {
      return { eligible: false, exclusionReason: 'category mismatch' };
    }

    // Brand match
    const targetBrand = normalizeSlug(context.brandKey);
    const applicableBrands = (candidate.applicable_brands ?? []).map(
      normalizeSlug
    );

    if (candidate.guide_scope === 'brand_family_guide') {
      if (applicableBrands.length === 0) {
        return {
          eligible: false,
          exclusionReason:
            'brand_family_guide requires at least 1 applicable brand',
        };
      }
      if (!targetBrand || !applicableBrands.includes(targetBrand)) {
        return {
          eligible: false,
          exclusionReason: `brand mismatch: target "${targetBrand}" not in [${applicableBrands.join(', ')}]`,
        };
      }
      return { eligible: true, reason: 'brand_family_guide' };
    }

    if (candidate.guide_scope === 'category_guide') {
      if (applicableBrands.length === 0) {
        return { eligible: true, reason: 'category_guide' };
      }
      if (!targetBrand || !applicableBrands.includes(targetBrand)) {
        return {
          eligible: false,
          exclusionReason: `category_guide restricted to brands [${applicableBrands.join(', ')}], target "${targetBrand}" does not match`,
        };
      }
      return { eligible: true, reason: 'category_guide' };
    }
  }

  return {
    eligible: false,
    exclusionReason: 'does not satisfy ALLOW rules',
  };
}
