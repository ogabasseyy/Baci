import { describe, expect, it } from 'vitest';
import { buildProductGuideLinks } from './build-product-guide-links';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function makeInput(
  overrides: Partial<BuildProductSemanticModelInput> = {}
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    currentProduct: {
      id: 'prod-iphone-16e',
      slug: 'iphone-16e',
      name: 'iPhone 16e',
      price: 450_000,
      brand: 'Apple',
      condition: 'new',
      stock: 4,
      category_slug: 'smartphones',
      product_key_specs: {},
    },
    inventory: [],
    ...overrides,
  };
}

describe('buildProductGuideLinks v2 metadata-first integration', () => {
  const hpOmenProductId = '11111111-1111-4111-8111-111111111111';
  const eaSportsProductId = '22222222-2222-4222-8222-222222222222';
  const a15ProductId = '33333333-3333-4333-8333-333333333333';
  const s25UltraProductId = '44444444-4444-4444-8444-444444444444';

  it('accepts HP Omen review on HP Omen PDP and rejects on EA Sports FC 27 even in prioritySlugs', () => {
    const hpOmenPost = {
      slug: 'hp-omen-16-review',
      title: 'HP Omen 16 (2026): Full Review & Guide',
      excerpt: 'Comprehensive gaming laptop guide.',
      category: 'Gaming',
      tags: ['gaming', 'hp omen'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-03-01T00:00:00Z',
      reading_time_minutes: 6,
      guide_scope: 'product_specific' as const,
      guide_kind: 'buyer-guide' as const,
      metadata_status: 'verified' as const,
      cluster_category_slug: 'gaming-laptops',
      applicable_brands: ['hp'],
      subjects: [
        { productId: hpOmenProductId, subjectRole: 'primary' as const },
      ],
    };

    // On HP Omen PDP -> ACCEPTED
    const hpLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'gaming-laptops',
        categoryName: 'Gaming Laptops',
        currentProduct: {
          id: hpOmenProductId,
          slug: 'hp-omen-16',
          name: 'HP Omen 16',
          price: 1_200_000,
          brand: 'HP',
          category_slug: 'gaming-laptops',
        },
        priorityGuidePostSlugs: [hpOmenPost.slug],
        guidePosts: [hpOmenPost],
      })
    );
    expect(hpLinks).toHaveLength(1);
    expect(hpLinks[0].href).toBe(
      'https://ogabassey.com/blog/hp-omen-16-review'
    );

    // On EA Sports FC 27 PDP -> REJECTED even with priorityGuidePostSlugs
    const eaLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        categoryName: 'PlayStation 5',
        currentProduct: {
          id: eaSportsProductId,
          slug: 'ea-sports-fc-27',
          name: 'EA Sports FC 27',
          price: 90_000,
          brand: 'EA Sports',
          category_slug: 'playstation-5',
        },
        priorityGuidePostSlugs: [hpOmenPost.slug],
        guidePosts: [hpOmenPost],
      })
    );
    expect(eaLinks).toHaveLength(0);
  });

  it('rejects Galaxy A15 article on Galaxy S25 Ultra PDP even in prioritySlugs', () => {
    const a15Post = {
      slug: 'samsung-galaxy-a15-guide',
      title: 'Samsung Galaxy A15 Buying Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: ['samsung'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-03-01T00:00:00Z',
      reading_time_minutes: 5,
      guide_scope: 'product_specific' as const,
      guide_kind: 'buyer-guide' as const,
      metadata_status: 'verified' as const,
      cluster_category_slug: 'smartphones',
      applicable_brands: ['samsung'],
      subjects: [{ productId: a15ProductId, subjectRole: 'primary' as const }],
    };

    const s25Links = buildProductGuideLinks(
      makeInput({
        currentProduct: {
          id: s25UltraProductId,
          slug: 'galaxy-s25-ultra',
          name: 'Samsung Galaxy S25 Ultra',
          price: 1_500_000,
          brand: 'Samsung',
          category_slug: 'smartphones',
        },
        priorityGuidePostSlugs: [a15Post.slug],
        guidePosts: [a15Post],
      })
    );
    expect(s25Links).toEqual([]);
  });

  it('accepts playstation-5 category_guide and nokia brand_family_guide directly', () => {
    const ps5Guide = {
      slug: 'playstation-5-console-buyer-guide',
      title: 'PlayStation 5 Console Buyer Guide',
      excerpt: 'Everything to know before buying a PS5.',
      category: 'PlayStation 5',
      tags: ['ps5'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-03-01T00:00:00Z',
      reading_time_minutes: 7,
      guide_scope: 'category_guide' as const,
      guide_kind: 'buyer-guide' as const,
      metadata_status: 'verified' as const,
      cluster_category_slug: 'playstation-5',
      applicable_brands: [],
    };

    const ps5Links = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        categoryName: 'PlayStation 5',
        currentProduct: {
          id: 'ps5-console-id',
          slug: 'playstation-5-console',
          name: 'PlayStation 5 Digital Edition',
          price: 750_000,
          brand: 'Sony',
          category_slug: 'playstation-5',
        },
        guidePosts: [ps5Guide],
      })
    );
    expect(ps5Links).toHaveLength(1);
    expect(ps5Links[0].href).toBe(
      'https://ogabassey.com/blog/playstation-5-console-buyer-guide'
    );

    const nokiaGuide = {
      slug: 'best-nokia-smartphones-nigeria',
      title: 'Best Nokia Smartphones in Nigeria (2026)',
      excerpt: 'Top Nokia phones compared.',
      category: 'Smartphones',
      tags: ['nokia'],
      keywords: ['best in nigeria'],
      featured_image_url: null,
      published_at: '2026-03-01T00:00:00Z',
      reading_time_minutes: 5,
      guide_scope: 'brand_family_guide' as const,
      guide_kind: 'best-in-nigeria' as const,
      metadata_status: 'verified' as const,
      cluster_category_slug: 'smartphones',
      applicable_brands: ['nokia'],
    };

    const nokiaLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        currentProduct: {
          id: 'nokia-g42-id',
          slug: 'nokia-g42',
          name: 'Nokia G42 5G',
          price: 180_000,
          brand: 'Nokia',
          category_slug: 'smartphones',
        },
        guidePosts: [nokiaGuide],
      })
    );
    expect(nokiaLinks).toHaveLength(1);
    expect(nokiaLinks[0].href).toBe(
      'https://ogabassey.com/blog/best-nokia-smartphones-nigeria'
    );
  });

  it('rejects stale or unverified or general_news posts even if in priorityGuidePostSlugs', () => {
    const stalePost = {
      slug: 'stale-guide',
      title: 'Stale Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: [],
      keywords: [],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 3,
      guide_scope: 'category_guide' as const,
      guide_kind: 'buyer-guide' as const,
      metadata_status: 'stale' as const,
      cluster_category_slug: 'smartphones',
    };

    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [stalePost.slug],
        guidePosts: [stalePost],
      })
    );
    expect(links).toEqual([]);
  });

  it('rejects V2 post with category mismatch or invalid guide_kind and caps results at 3', () => {
    const wrongCategoryPost = {
      slug: 'wrong-cat-guide',
      title: 'Wrong Category Guide',
      excerpt: null,
      category: 'Laptops',
      tags: [],
      keywords: [],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 3,
      guide_scope: 'category_guide' as const,
      guide_kind: 'buyer-guide' as const,
      metadata_status: 'verified' as const,
      cluster_category_slug: 'laptops',
    };

    expect(
      buildProductGuideLinks(
        makeInput({
          categorySlug: 'smartphones',
          guidePosts: [wrongCategoryPost],
        })
      )
    ).toEqual([]);

    const guides = [1, 2, 3, 4].map((i) => ({
      slug: `ps5-guide-${i}`,
      title: `PS5 Guide ${i}`,
      excerpt: null,
      category: 'PlayStation 5',
      tags: [],
      keywords: [],
      featured_image_url: null,
      published_at: `2026-03-0${i}T00:00:00Z`,
      reading_time_minutes: 4,
      guide_scope: 'category_guide' as const,
      guide_kind: 'buyer-guide' as const,
      metadata_status: 'verified' as const,
      cluster_category_slug: 'playstation-5',
    }));

    const result = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        guidePosts: guides,
      })
    );
    expect(result).toHaveLength(3);
  });
});
