import { describe, expect, it } from 'vitest';
import {
  blogGuideMetadataSchema,
  GUIDE_SCOPE_KIND_MATRIX,
  isNonBrandPlaceholderKey,
} from './blog-guide-metadata';

describe('blogGuideMetadataSchema', () => {
  const validCategoryId = '11111111-1111-4111-8111-111111111111';
  const validProductId1 = '22222222-2222-4222-8222-222222222222';
  const validProductId2 = '33333333-3333-4333-8333-333333333333';

  it('matches exact GUIDE_SCOPE_KIND_MATRIX contract from plan §2.2', () => {
    expect(GUIDE_SCOPE_KIND_MATRIX).toEqual({
      product_specific: ['buyer-guide'],
      model_comparison: ['decision-support'],
      brand_family_guide: ['buyer-guide', 'best-in-nigeria'],
      category_guide: ['buyer-guide', 'best-in-nigeria'],
      troubleshooting: ['troubleshooting'],
      general_news: [null],
    });
  });

  describe('isNonBrandPlaceholderKey', () => {
    it('identifies placeholder brand keys', () => {
      const placeholders = [
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
      ];
      for (const key of placeholders) {
        expect(isNonBrandPlaceholderKey(key)).toBe(true);
        expect(isNonBrandPlaceholderKey(key.toUpperCase())).toBe(true);
        expect(isNonBrandPlaceholderKey(`  ${key}  `)).toBe(true);
        expect(isNonBrandPlaceholderKey(` -${key}- `)).toBe(true);
      }
      expect(isNonBrandPlaceholderKey('gaming!')).toBe(true);
      expect(isNonBrandPlaceholderKey('--unbranded--')).toBe(true);
    });

    it('allows genuine brand keys', () => {
      expect(isNonBrandPlaceholderKey('apple')).toBe(false);
      expect(isNonBrandPlaceholderKey('samsung')).toBe(false);
      expect(isNonBrandPlaceholderKey('hp')).toBe(false);
      expect(isNonBrandPlaceholderKey('sony')).toBe(false);
      expect(isNonBrandPlaceholderKey('nokia')).toBe(false);
      expect(isNonBrandPlaceholderKey('alienware')).toBe(false);
    });

    it('rejects placeholder keys in applicableBrands schema', () => {
      const result = blogGuideMetadataSchema.safeParse({
        applicableBrands: ['apple', 'gaming'],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'placeholder brand key: "gaming"'
        );
      }
    });

    it('transforms raw brand names to normalized slug keys', () => {
      const result = blogGuideMetadataSchema.safeParse({
        applicableBrands: [' Apple ', 'EA Sports', 'Sony PlayStation'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.applicableBrands).toEqual([
          'apple',
          'ea-sports',
          'sony-playstation',
        ]);
      }
    });
  });

  describe('familyScope restriction', () => {
    it('rejects non-empty familyScope in first release', () => {
      const strResult = blogGuideMetadataSchema.safeParse({
        familyScope: 'galaxy-s-series',
      });
      expect(strResult.success).toBe(false);

      const arrResult = blogGuideMetadataSchema.safeParse({
        familyScope: ['galaxy-s-series'],
      });
      expect(arrResult.success).toBe(false);
    });

    it('accepts null or undefined familyScope', () => {
      const nullResult = blogGuideMetadataSchema.safeParse({
        familyScope: null,
      });
      expect(nullResult.success).toBe(true);
    });
  });

  describe('Scope x Kind matrix validation', () => {
    it('rejects incompatible scope x kind pairs', () => {
      const result = blogGuideMetadataSchema.safeParse({
        guideScope: 'product_specific',
        guideKind: 'decision-support',
      });
      expect(result.success).toBe(false);
    });

    it('permits valid pairs', () => {
      const result = blogGuideMetadataSchema.safeParse({
        guideScope: 'product_specific',
        guideKind: 'buyer-guide',
      });
      expect(result.success).toBe(true);
    });

    it('requires guideKind to be null for general_news', () => {
      const invalid = blogGuideMetadataSchema.safeParse({
        guideScope: 'general_news',
        guideKind: 'buyer-guide',
      });
      expect(invalid.success).toBe(false);

      const valid = blogGuideMetadataSchema.safeParse({
        guideScope: 'general_news',
        guideKind: null,
      });
      expect(valid.success).toBe(true);
    });
  });

  describe('Verification validation', () => {
    it('rejects metadataContractVersion below 2', () => {
      expect(
        blogGuideMetadataSchema.safeParse({ metadataContractVersion: 1 })
          .success
      ).toBe(false);
    });

    it('rejects general_news when metadataStatus is verified', () => {
      const result = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'general_news',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
      });
      expect(result.success).toBe(false);
    });

    it('requires clusterCategoryId and metadataSourceRevision when verified', () => {
      const result = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'category_guide',
        guideKind: 'buyer-guide',
      });
      expect(result.success).toBe(false);
    });

    it('validates product_specific requires >= 1 primary subject', () => {
      const noSubject = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'product_specific',
        guideKind: 'buyer-guide',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        subjects: [],
      });
      expect(noSubject.success).toBe(false);

      const withPrimary = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'product_specific',
        guideKind: 'buyer-guide',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        subjects: [{ productId: validProductId1, subjectRole: 'primary' }],
      });
      expect(withPrimary.success).toBe(true);
    });

    it('validates model_comparison requires >= 2 distinct comparison subjects', () => {
      const oneSubject = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'model_comparison',
        guideKind: 'decision-support',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        subjects: [{ productId: validProductId1, subjectRole: 'comparison' }],
      });
      expect(oneSubject.success).toBe(false);

      const twoSubjects = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'model_comparison',
        guideKind: 'decision-support',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        subjects: [
          { productId: validProductId1, subjectRole: 'comparison' },
          { productId: validProductId2, subjectRole: 'comparison' },
        ],
      });
      expect(twoSubjects.success).toBe(true);
    });

    it('validates troubleshooting requires >= 1 product_support subject', () => {
      const invalid = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'troubleshooting',
        guideKind: 'troubleshooting',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        subjects: [],
      });
      expect(invalid.success).toBe(false);

      const valid = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'troubleshooting',
        guideKind: 'troubleshooting',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        subjects: [
          { productId: validProductId1, subjectRole: 'product_support' },
        ],
      });
      expect(valid.success).toBe(true);
    });

    it('validates brand_family_guide requires >= 1 brand and 0 subjects', () => {
      const noBrand = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'brand_family_guide',
        guideKind: 'buyer-guide',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        applicableBrands: [],
      });
      expect(noBrand.success).toBe(false);

      const withSubjects = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'brand_family_guide',
        guideKind: 'buyer-guide',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        applicableBrands: ['nokia'],
        subjects: [{ productId: validProductId1, subjectRole: 'primary' }],
      });
      expect(withSubjects.success).toBe(false);

      const valid = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'brand_family_guide',
        guideKind: 'buyer-guide',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        applicableBrands: ['nokia'],
        subjects: [],
      });
      expect(valid.success).toBe(true);
    });

    it('validates category_guide requires 0 subjects and accepts empty or populated brands', () => {
      const withSubjects = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'category_guide',
        guideKind: 'best-in-nigeria',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        subjects: [{ productId: validProductId1, subjectRole: 'primary' }],
      });
      expect(withSubjects.success).toBe(false);

      const validBrandNeutral = blogGuideMetadataSchema.safeParse({
        metadataStatus: 'verified',
        guideScope: 'category_guide',
        guideKind: 'best-in-nigeria',
        clusterCategoryId: validCategoryId,
        metadataSourceRevision: 'rev-1',
        applicableBrands: [],
        subjects: [],
      });
      expect(validBrandNeutral.success).toBe(true);
    });
  });
});
