import { z } from 'zod';

export const GUIDE_SCOPE_KIND_MATRIX = {
  product_specific: ['buyer-guide'],
  model_comparison: ['decision-support'],
  brand_family_guide: ['buyer-guide', 'best-in-nigeria'],
  category_guide: ['buyer-guide', 'best-in-nigeria'],
  troubleshooting: ['troubleshooting'],
  general_news: [null],
} as const;

export type GuideScope = keyof typeof GUIDE_SCOPE_KIND_MATRIX;
export type GuideKind =
  | 'buyer-guide'
  | 'best-in-nigeria'
  | 'decision-support'
  | 'troubleshooting';
export type MetadataSource =
  | 'publisher'
  | 'author'
  | 'backfill_verified'
  | 'unverified';
export type MetadataStatus =
  | 'unverified'
  | 'proposed'
  | 'verified'
  | 'stale'
  | 'rejected';
export type SubjectRole = 'primary' | 'comparison' | 'product_support';

export const NON_BRAND_PLACEHOLDER_KEYS = new Set([
  'gaming',
  'game',
  'generic',
  'unbranded',
  'other',
  'n-a',
  'none',
  'unknown',
  'null',
  'undefined',
  'test',
  'default',
]);

export function normalizeBrandKey(key: string): string {
  return (key ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isNonBrandPlaceholderKey(key: string): boolean {
  if (!key) return true;
  return NON_BRAND_PLACEHOLDER_KEYS.has(normalizeBrandKey(key));
}

export const blogPostGuideSubjectSchema = z.object({
  productId: z.string().uuid(),
  subjectRole: z.enum(['primary', 'comparison', 'product_support']),
  sourceRevision: z.string().nullish(),
});

export type BlogPostGuideSubjectInput = z.infer<
  typeof blogPostGuideSubjectSchema
>;

export const blogGuideMetadataSchema = z
  .object({
    guideScope: z
      .enum([
        'product_specific',
        'model_comparison',
        'brand_family_guide',
        'category_guide',
        'troubleshooting',
        'general_news',
      ])
      .nullish(),
    guideKind: z
      .enum([
        'buyer-guide',
        'best-in-nigeria',
        'decision-support',
        'troubleshooting',
      ])
      .nullish(),
    clusterCategoryId: z.string().uuid().nullish(),
    applicableBrands: z
      .array(z.string().min(1).transform(normalizeBrandKey))
      .default([]),
    subjects: z.array(blogPostGuideSubjectSchema).default([]),
    familyScope: z
      .union([z.string(), z.array(z.string()), z.null(), z.undefined()])
      .nullish(),
    metadataSource: z
      .enum(['publisher', 'author', 'backfill_verified', 'unverified'])
      .default('unverified'),
    metadataStatus: z
      .enum(['unverified', 'proposed', 'verified', 'stale', 'rejected'])
      .default('unverified'),
    metadataContractVersion: z.number().int().min(2).default(2),
    metadataSourceRevision: z.string().nullish(),
    metadataContentHash: z.string().nullish(),
    metadataVerifiedAt: z.string().datetime().nullish(),
    metadataVerifiedBy: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    // 1. Reject non-empty familyScope in the first release
    if (data.familyScope) {
      if (
        typeof data.familyScope === 'string' &&
        data.familyScope.trim() !== ''
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'familyScope is unsupported in first release and must be empty',
          path: ['familyScope'],
        });
      } else if (
        Array.isArray(data.familyScope) &&
        data.familyScope.length > 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'familyScope is unsupported in first release and must be empty',
          path: ['familyScope'],
        });
      }
    }

    // 2. Reject non-brand placeholder keys in applicableBrands
    for (let i = 0; i < data.applicableBrands.length; i++) {
      const brand = data.applicableBrands[i];
      if (isNonBrandPlaceholderKey(brand)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `applicableBrands contains placeholder brand key: "${brand}"`,
          path: ['applicableBrands', i],
        });
      }
    }

    // 3. General news cannot have a guideKind
    if (data.guideScope === 'general_news' && data.guideKind != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'guideKind must be null when guideScope is general_news',
        path: ['guideKind'],
      });
    }

    // 4. Validate Scope x Kind pair when both are non-null
    if (data.guideScope && data.guideKind) {
      const allowedKinds = GUIDE_SCOPE_KIND_MATRIX[data.guideScope];
      if (
        !allowedKinds ||
        !(allowedKinds as readonly (string | null)[]).includes(data.guideKind)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid scope x kind combination: scope "${data.guideScope}" does not permit kind "${data.guideKind}"`,
          path: ['guideKind'],
        });
      }
    }

    // 5. Verification validation
    if (data.metadataStatus === 'verified') {
      if (!data.guideScope) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'guideScope is required when metadataStatus is verified',
          path: ['guideScope'],
        });
      }

      if (data.guideScope === 'general_news') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'general_news cannot be verified as a guide recommendation',
          path: ['guideScope'],
        });
      }

      if (!data.guideKind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'guideKind is required when metadataStatus is verified',
          path: ['guideKind'],
        });
      }

      if (!data.clusterCategoryId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'clusterCategoryId is required when metadataStatus is verified',
          path: ['clusterCategoryId'],
        });
      }

      if (
        !data.metadataSourceRevision ||
        data.metadataSourceRevision.trim() === ''
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'metadataSourceRevision is required when metadataStatus is verified',
          path: ['metadataSourceRevision'],
        });
      }

      // Scope-specific subject & brand rules when verified
      if (data.guideScope === 'product_specific') {
        const hasPrimary = data.subjects.some(
          (s) => s.subjectRole === 'primary'
        );
        if (!hasPrimary) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'product_specific scope requires at least 1 primary subject',
            path: ['subjects'],
          });
        }
      } else if (data.guideScope === 'model_comparison') {
        const comparisonIds = new Set(
          data.subjects
            .filter((s) => s.subjectRole === 'comparison')
            .map((s) => s.productId)
        );
        if (comparisonIds.size < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'model_comparison scope requires at least 2 distinct comparison subjects',
            path: ['subjects'],
          });
        }
      } else if (data.guideScope === 'troubleshooting') {
        const hasSupport = data.subjects.some(
          (s) => s.subjectRole === 'product_support'
        );
        if (!hasSupport) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'troubleshooting scope requires at least 1 product_support subject',
            path: ['subjects'],
          });
        }
      } else if (data.guideScope === 'brand_family_guide') {
        if (data.applicableBrands.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'brand_family_guide requires at least 1 valid applicable brand key',
            path: ['applicableBrands'],
          });
        }
        if (data.subjects.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'brand_family_guide must have 0 product subjects in first release',
            path: ['subjects'],
          });
        }
      } else if (data.guideScope === 'category_guide') {
        if (data.subjects.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'category_guide must have 0 product subjects',
            path: ['subjects'],
          });
        }
      }
    }
  });

export type BlogGuideMetadataInput = z.infer<typeof blogGuideMetadataSchema>;
