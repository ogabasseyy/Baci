import type { GuideKind, GuideScope } from '@/schemas/blog-guide-metadata';

export interface ReviewedCohortPostSubject {
  productId: string;
  role: 'primary' | 'comparison' | 'product_support';
}

export interface ReviewedCohortPost {
  postId: string;
  postSlug: string;
  title: string;
  scope: GuideScope;
  kind: GuideKind;
  clusterCategorySlug: string;
  applicableBrands: string[];
  contentHash: string;
  revision: string;
  subjects?: ReviewedCohortPostSubject[];
}

export interface RejectedCohortFixture {
  postSlug: string;
  rejectionReason: string;
}

export interface ExpectedCohortGuideLink {
  postSlug: string;
  eligibilityReason:
    | 'subject_primary'
    | 'subject_comparison'
    | 'subject_product_support'
    | 'brand_family_guide'
    | 'category_guide';
}

export interface FirstReleaseCohortPdpEntry {
  productId: string;
  productSlug: string;
  productName: string;
  categorySlug: string;
  brand: string;
  canonicalRouteAliases: [string, string];
  selectionReason: string;
  priorityGroup:
    | 'confirmed_cross_category_regression'
    | 'high_traffic_pdp'
    | 'general_catalog';
  expectedGuides: ExpectedCohortGuideLink[];
  rejectedFixtures: RejectedCohortFixture[];
  emptySectionReason: string | null;
}
