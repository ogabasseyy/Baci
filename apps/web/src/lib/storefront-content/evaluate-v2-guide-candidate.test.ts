import { describe, expect, it } from 'vitest';
import {
  evaluateV2GuideCandidate,
  type V2GuideCandidate,
} from './evaluate-v2-guide-candidate';

describe('evaluateV2GuideCandidate', () => {
  const hpOmenProductId = '11111111-1111-4111-8111-111111111111';
  const eaSportsProductId = '22222222-2222-4222-8222-222222222222';
  const galaxyA15ProductId = '33333333-3333-4333-8333-333333333333';
  const galaxyS25UltraProductId = '44444444-4444-4444-8444-444444444444';
  const alienwareProductId = '55555555-5555-4555-8555-555555555555';
  const rogProductId = '66666666-6666-4666-8666-666666666666';

  const gamingCategoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const playstation5CategoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const smartphonesCategoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  it('accepts HP Omen review on HP Omen PDP and rejects on EA Sports FC 27 PDP even with Gaming category', () => {
    const hpOmenGuide: V2GuideCandidate = {
      slug: 'hp-omen-16-2026-price-in-nigeria-specs-where-to-buy',
      title: 'HP Omen 16 (2026): Price in Nigeria, Specs & Where to Buy',
      category: 'Gaming',
      cluster_category_id: gamingCategoryId,
      cluster_category_slug: 'gaming-laptops',
      guide_scope: 'product_specific',
      guide_kind: 'buyer-guide',
      metadata_status: 'verified',
      metadata_source_revision: 'rev-hp-1',
      metadata_contract_version: 2,
      applicable_brands: ['hp'],
      subjects: [{ productId: hpOmenProductId, subjectRole: 'primary' }],
    };

    // On HP Omen PDP -> ACCEPTED
    const hpResult = evaluateV2GuideCandidate(hpOmenGuide, {
      productId: hpOmenProductId,
      categoryId: gamingCategoryId,
      categorySlug: 'gaming-laptops',
      brandKey: 'HP',
    });
    expect(hpResult.eligible).toBe(true);
    expect(hpResult.reason).toBe('subject_primary');

    // On EA Sports FC 27 PDP (even though legacy category is Gaming) -> REJECTED
    const eaResult = evaluateV2GuideCandidate(hpOmenGuide, {
      productId: eaSportsProductId,
      categoryId: playstation5CategoryId,
      categorySlug: 'playstation-5',
      brandKey: 'EA Sports',
    });
    expect(eaResult.eligible).toBe(false);
    expect(eaResult.exclusionReason).toContain(
      'requires explicit subject match'
    );
  });

  it('accepts model comparison only for declared comparison participant productIds', () => {
    const comparisonGuide: V2GuideCandidate = {
      slug: 'alienware-vs-rog-2026',
      title: 'Alienware m18 vs ASUS ROG Zephyrus G16 (2026)',
      category: 'Gaming Laptops',
      cluster_category_slug: 'gaming-laptops',
      guide_scope: 'model_comparison',
      guide_kind: 'decision-support',
      metadata_status: 'verified',
      metadata_source_revision: 'rev-comp-1',
      metadata_contract_version: 2,
      applicable_brands: ['dell', 'asus'],
      subjects: [
        { productId: alienwareProductId, subjectRole: 'comparison' },
        { productId: rogProductId, subjectRole: 'comparison' },
      ],
    };

    // On Alienware PDP -> ACCEPTED
    const alienwareResult = evaluateV2GuideCandidate(comparisonGuide, {
      productId: alienwareProductId,
      categorySlug: 'gaming-laptops',
      brandKey: 'Dell',
    });
    expect(alienwareResult.eligible).toBe(true);
    expect(alienwareResult.reason).toBe('subject_comparison');

    // On ROG PDP -> ACCEPTED
    const rogResult = evaluateV2GuideCandidate(comparisonGuide, {
      productId: rogProductId,
      categorySlug: 'gaming-laptops',
      brandKey: 'ASUS',
    });
    expect(rogResult.eligible).toBe(true);
    expect(rogResult.reason).toBe('subject_comparison');

    // On HP Omen PDP (not a participant) -> REJECTED
    const hpResult = evaluateV2GuideCandidate(comparisonGuide, {
      productId: hpOmenProductId,
      categorySlug: 'gaming-laptops',
      brandKey: 'HP',
    });
    expect(hpResult.eligible).toBe(false);
    expect(hpResult.exclusionReason).toContain(
      'requires explicit subject match'
    );
  });

  it('rejects Samsung Galaxy A15 article on Galaxy S25 Ultra PDP', () => {
    const a15Guide: V2GuideCandidate = {
      slug: 'samsung-galaxy-a15-buyer-guide',
      title: 'Samsung Galaxy A15 Buyer Guide (2026)',
      category: 'Smartphones',
      cluster_category_id: smartphonesCategoryId,
      cluster_category_slug: 'smartphones',
      guide_scope: 'product_specific',
      guide_kind: 'buyer-guide',
      metadata_status: 'verified',
      metadata_source_revision: 'rev-a15',
      metadata_contract_version: 2,
      applicable_brands: ['samsung'],
      subjects: [{ productId: galaxyA15ProductId, subjectRole: 'primary' }],
    };

    const s25Result = evaluateV2GuideCandidate(a15Guide, {
      productId: galaxyS25UltraProductId,
      categoryId: smartphonesCategoryId,
      categorySlug: 'smartphones',
      brandKey: 'Samsung',
    });
    expect(s25Result.eligible).toBe(false);
    expect(s25Result.exclusionReason).toContain(
      'requires explicit subject match'
    );
  });

  it('matches product with multiple subject roles when the required role is present', () => {
    const multiRoleGuide: V2GuideCandidate = {
      slug: 'iphone-vs-galaxy-comparison',
      title: 'iPhone 16 vs Galaxy S25 Comparison',
      category: 'Smartphones',
      cluster_category_slug: 'smartphones',
      guide_scope: 'model_comparison',
      guide_kind: 'decision-support',
      metadata_status: 'verified',
      metadata_source_revision: 'rev-multi-1',
      metadata_contract_version: 2,
      subjects: [
        { productId: 'prod-target', subjectRole: 'primary' },
        { productId: 'prod-target', subjectRole: 'comparison' },
      ],
    };

    const result = evaluateV2GuideCandidate(multiRoleGuide, {
      productId: 'prod-target',
      categorySlug: 'smartphones',
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('subject_comparison');
  });

  it('accepts verified playstation-5 category_guide and nokia brand_family_guide without alias-list edits', () => {
    const ps5CategoryGuide: V2GuideCandidate = {
      slug: 'ps5-buyer-guide-nigeria',
      title: 'PlayStation 5 Buying Guide in Nigeria (2026)',
      category: 'PlayStation 5',
      cluster_category_slug: 'playstation-5',
      guide_scope: 'category_guide',
      guide_kind: 'buyer-guide',
      metadata_status: 'verified',
      metadata_source_revision: 'rev-ps5',
      metadata_contract_version: 2,
      applicable_brands: [], // brand-neutral
    };

    const ps5Result = evaluateV2GuideCandidate(ps5CategoryGuide, {
      productId: eaSportsProductId,
      categorySlug: 'playstation-5',
      brandKey: 'EA Sports',
    });
    expect(ps5Result.eligible).toBe(true);
    expect(ps5Result.reason).toBe('category_guide');

    const nokiaGuide: V2GuideCandidate = {
      slug: 'nokia-phones-guide-nigeria',
      title: 'Best Nokia Phones in Nigeria (2026)',
      category: 'Smartphones',
      cluster_category_slug: 'smartphones',
      guide_scope: 'brand_family_guide',
      guide_kind: 'best-in-nigeria',
      metadata_status: 'verified',
      metadata_source_revision: 'rev-nokia',
      metadata_contract_version: 2,
      applicable_brands: ['nokia'],
    };

    const nokiaResult = evaluateV2GuideCandidate(nokiaGuide, {
      productId: '77777777-7777-4777-8777-777777777777',
      categorySlug: 'smartphones',
      brandKey: 'Nokia',
    });
    expect(nokiaResult.eligible).toBe(true);
    expect(nokiaResult.reason).toBe('brand_family_guide');
  });
});
