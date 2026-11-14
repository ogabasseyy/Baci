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

function makeV2Post(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'v2-guide',
    title: 'V2 Guide',
    excerpt: 'Comprehensive guide.',
    category: 'Guide',
    tags: [] as string[],
    keywords: [] as string[],
    featured_image_url: null,
    published_at: '2026-03-01T00:00:00Z',
    reading_time_minutes: 5,
    metadata_status: 'verified' as const,
    metadata_contract_version: 2,
    metadata_source_revision: 'rev-v2-1',
    applicable_brands: [] as string[],
    ...overrides,
  };
}

describe('buildProductGuideLinks v2 metadata-first integration', () => {
  const hpOmenProductId = '11111111-1111-4111-8111-111111111111';
  const eaSportsProductId = '22222222-2222-4222-8222-222222222222';
  const a15ProductId = '33333333-3333-4333-8333-333333333333';
  const s25UltraProductId = '44444444-4444-4444-8444-444444444444';

  it('accepts HP Omen review on HP Omen PDP and rejects on EA Sports FC 27 even in prioritySlugs', () => {
    const hpOmenPost = makeV2Post({
      slug: 'hp-omen-16-review',
      title: 'HP Omen 16 (2026): Full Review & Guide',
      category: 'Gaming',
      tags: ['gaming', 'hp omen'],
      guide_scope: 'product_specific',
      guide_kind: 'buyer-guide',
      cluster_category_slug: 'gaming-laptops',
      applicable_brands: ['hp'],
      subjects: [
        { productId: hpOmenProductId, subjectRole: 'primary' as const },
      ],
    });

    // On HP Omen PDP -> ACCEPTED
    const hpLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'gaming-laptops',
        categoryName: 'Gaming Laptops',
        currentProduct: {
          id: hpOmenProductId,
          slug: 'hp-omen-16',
          name: 'HP Omen 16 Gaming Laptop',
          price: 2_500_000,
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
    expect(hpLinks[0].title).toBe(hpOmenPost.title);

    // On EA Sports FC 27 PDP (even though legacy category is Gaming) -> REJECTED
    const eaLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        categoryName: 'PlayStation 5',
        currentProduct: {
          id: eaSportsProductId,
          slug: 'ea-sports-fc-27-ps5',
          name: 'EA Sports FC 27 (PS5)',
          price: 95_000,
          brand: 'EA Sports',
          category_slug: 'playstation-5',
        },
        priorityGuidePostSlugs: [hpOmenPost.slug],
        guidePosts: [hpOmenPost],
      })
    );
    expect(eaLinks).toEqual([]);
  });

  it('rejects Samsung Galaxy A15 article on Galaxy S25 Ultra PDP even in prioritySlugs', () => {
    const a15Post = makeV2Post({
      slug: 'samsung-galaxy-a15-guide',
      title: 'Samsung Galaxy A15 Buying Guide',
      category: 'Smartphones',
      guide_scope: 'product_specific',
      guide_kind: 'buyer-guide',
      cluster_category_slug: 'smartphones',
      applicable_brands: ['samsung'],
      subjects: [{ productId: a15ProductId, subjectRole: 'primary' as const }],
    });

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
    const ps5Guide = makeV2Post({
      slug: 'playstation-5-console-buyer-guide',
      title: 'PlayStation 5 Console Buyer Guide',
      category: 'PlayStation 5',
      guide_scope: 'category_guide',
      guide_kind: 'buyer-guide',
      cluster_category_slug: 'playstation-5',
    });

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

    const nokiaGuide = makeV2Post({
      slug: 'best-nokia-smartphones-nigeria',
      title: 'Best Nokia Smartphones in Nigeria (2026)',
      category: 'Smartphones',
      guide_scope: 'brand_family_guide',
      guide_kind: 'best-in-nigeria',
      cluster_category_slug: 'smartphones',
      applicable_brands: ['nokia'],
    });

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
    const stalePost = makeV2Post({
      slug: 'stale-guide',
      title: 'Stale Guide',
      guide_scope: 'category_guide',
      guide_kind: 'buyer-guide',
      metadata_status: 'stale',
      cluster_category_slug: 'smartphones',
    });

    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [stalePost.slug],
        guidePosts: [stalePost],
      })
    );
    expect(links).toEqual([]);

    const reclassifiedNewsV2Post = makeV2Post({
      slug: 'reclassified-news-v2-guide',
      title: 'Reclassified News V2 Guide',
      guide_scope: 'category_guide',
      guide_kind: 'buyer-guide',
      metadata_status: 'verified',
      cluster_category_slug: 'smartphones',
      merchant_intent: 'news',
      merchant_intent_source: 'merchant_declared',
    });

    expect(
      buildProductGuideLinks(
        makeInput({
          priorityGuidePostSlugs: [reclassifiedNewsV2Post.slug],
          guidePosts: [reclassifiedNewsV2Post],
        })
      )
    ).toEqual([]);

    const partialUnverifiedV2Post = {
      slug: 'best-iphone-buying-guide-nigeria',
      title: 'Best iPhone Buying Guide in Nigeria',
      excerpt: 'Compare iPhone models.',
      category: 'Smartphones',
      tags: ['iphone', 'buying guide'],
      keywords: ['iphone'],
      featured_image_url: null,
      published_at: '2026-03-01T00:00:00Z',
      reading_time_minutes: 5,
      guide_kind: 'troubleshooting' as const,
      metadata_status: 'unverified' as const,
    };

    expect(
      buildProductGuideLinks(
        makeInput({ guidePosts: [partialUnverifiedV2Post] })
      )
    ).toEqual([]);
  });

  it('rejects V2 post with category mismatch or invalid guide_kind and caps results at 3', () => {
    const wrongCategoryPost = makeV2Post({
      slug: 'wrong-cat-guide',
      title: 'Wrong Category Guide',
      category: 'Laptops',
      guide_scope: 'category_guide',
      guide_kind: 'buyer-guide',
      cluster_category_slug: 'laptops',
    });

    expect(
      buildProductGuideLinks(
        makeInput({
          categorySlug: 'smartphones',
          guidePosts: [wrongCategoryPost],
        })
      )
    ).toEqual([]);

    const guides = [1, 2, 3, 4].map((i) =>
      makeV2Post({
        slug: `ps5-guide-${i}`,
        title: `PS5 Guide ${i}`,
        category: 'PlayStation 5',
        published_at: `2026-03-0${i}T00:00:00Z`,
        guide_scope: 'category_guide',
        guide_kind: 'buyer-guide',
        cluster_category_slug: 'playstation-5',
      })
    );

    const result = buildProductGuideLinks(
      makeInput({ categorySlug: 'playstation-5', guidePosts: guides })
    );
    expect(result).toHaveLength(3);
  });
});
