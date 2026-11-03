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

describe('buildProductGuideLinks', () => {
  it('never renders trusted news as a product-priority buying guide', () => {
    const news = {
      slug: 'iphone-launch',
      title: 'iPhone Buying Guide Launch',
      excerpt: null,
      category: 'Smartphones',
      tags: ['buying-guide'],
      keywords: ['iphone'],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 4,
      merchant_intent: 'news' as const,
      merchant_intent_source: 'reviewed' as const,
    };
    expect(
      buildProductGuideLinks(
        makeInput({
          priorityGuidePostSlugs: [news.slug],
          guidePosts: [news],
        })
      )
    ).toEqual([]);
  });

  it('puts product-priority guides first with a stable fallback description', () => {
    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: ['iphone-buying-guide'],
        guidePosts: [
          {
            slug: 'iphone-buying-guide',
            title: 'iPhone Buying Guide',
            excerpt: null,
            category: null,
            tags: null,
            keywords: null,
            featured_image_url: null,
            published_at: null,
            reading_time_minutes: 4,
          },
        ],
      })
    );

    expect(links[0]).toMatchObject({
      href: 'https://ogabassey.com/blog/iphone-buying-guide',
      title: 'iPhone Buying Guide',
      description: '4 minute guide',
      kind: 'buyer-guide',
    });
  });

  it('returns no guide links for unsupported product categories', () => {
    expect(
      buildProductGuideLinks(
        makeInput({
          categorySlug: 'unknown-category',
          categoryName: 'Unknown Category',
        })
      )
    ).toEqual([]);
  });

  it('rejects cross-category HP Omen guide in priorityGuidePostSlugs for EA Sports FC 27 on both PS5 and gaming', () => {
    // In live data, HP Omen guide has category 'Gaming'. It infers categorySlug 'gaming-laptops'
    // via content tokens/categoryNames, so it is rejected on both playstation-5 and gaming PDPs.
    const gamingPost = {
      slug: 'hp-omen-16-2026-price-in-nigeria-specs-where-to-buy',
      title: 'HP Omen 16 (2026): Price in Nigeria, Specs & Where to Buy',
      excerpt: null,
      category: 'Gaming',
      tags: ['gaming', 'hp omen 16', 'gaming laptop'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 5,
    };

    const ps5Links = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        categoryName: 'PlayStation 5',
        currentProduct: {
          slug: 'ea-sports-fc-27',
          name: 'EA Sports FC 27',
          price: 90_000,
          brand: 'EA Sports',
          condition: 'new',
          stock: 5,
          category_slug: 'playstation-5',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [gamingPost.slug],
        guidePosts: [gamingPost],
      })
    );
    expect(ps5Links).toEqual([]);

    const gamingLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'gaming',
        categoryName: 'Gaming',
        currentProduct: {
          slug: 'ea-sports-fc-27',
          name: 'EA Sports FC 27',
          price: 90_000,
          brand: 'EA Sports',
          condition: 'new',
          stock: 5,
          category_slug: 'gaming',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [gamingPost.slug],
        guidePosts: [gamingPost],
      })
    );
    expect(gamingLinks).toEqual([]);
  });

  it('rejects cross-category gaming laptops comparison guide in priorityGuidePostSlugs for EA Sports FC 27 on both PS5 and gaming', () => {
    // In live data, this comparison guide has category 'Gaming'. It infers categorySlug 'gaming-laptops'
    // via content tokens/categoryNames, so it is rejected on both playstation-5 and gaming PDPs.
    const post = {
      slug: 'gaming-laptops-in-nigeria-2026-alienware-vs-rog-vs-legion-vs-omen',
      title:
        'Gaming Laptops in Nigeria (2026): Alienware vs ROG vs Legion vs Omen',
      excerpt: null,
      category: 'Gaming',
      tags: ['gaming', 'alienware', 'rog', 'legion', 'omen'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 6,
    };

    const ps5Links = buildProductGuideLinks(
      makeInput({
        categorySlug: 'playstation-5',
        categoryName: 'PlayStation 5',
        currentProduct: {
          slug: 'ea-sports-fc-27',
          name: 'EA Sports FC 27',
          price: 90_000,
          brand: 'EA Sports',
          condition: 'new',
          stock: 5,
          category_slug: 'playstation-5',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [post.slug],
        guidePosts: [post],
      })
    );
    expect(ps5Links).toEqual([]);

    const gamingLinks = buildProductGuideLinks(
      makeInput({
        categorySlug: 'gaming',
        categoryName: 'Gaming',
        currentProduct: {
          slug: 'ea-sports-fc-27',
          name: 'EA Sports FC 27',
          price: 90_000,
          brand: 'EA Sports',
          condition: 'new',
          stock: 5,
          category_slug: 'gaming',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [post.slug],
        guidePosts: [post],
      })
    );
    expect(gamingLinks).toEqual([]);
  });

  it('validates priority guides through buildCommercialGuideLinks rejecting cross-category priority posts', () => {
    const tabletPost = {
      slug: 'ipad-buyer-guide',
      title: 'iPad Buyer Guide',
      excerpt: null,
      category: 'Tablets',
      tags: ['tablets', 'apple'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 4,
    };

    const links = buildProductGuideLinks(
      makeInput({
        categorySlug: 'smartphones',
        categoryName: 'Smartphones',
        currentProduct: {
          slug: 'iphone-16e',
          name: 'iPhone 16e',
          price: 450_000,
          brand: 'Apple',
          condition: 'new',
          stock: 4,
          category_slug: 'smartphones',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [tabletPost.slug],
        guidePosts: [tabletPost],
      })
    );
    expect(links).toEqual([]);
  });

  it('rejects post with no valid guide kind in priorityGuidePostSlugs', () => {
    const post = {
      slug: 'company-news-announcement',
      title: 'Company News Announcement',
      excerpt: 'We have updated our store policies.',
      category: 'Smartphones',
      tags: ['announcement'],
      keywords: ['news'],
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 2,
    };

    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [post.slug],
        guidePosts: [post],
      })
    );
    expect(links).toEqual([]);
  });

  it('ranks legitimate priority guide ahead of fallback guides', () => {
    const priorityPost = {
      slug: 'iphone-buying-guide',
      title: 'iPhone Buying Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: ['smartphones', 'apple'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 4,
    };
    const fallbackPost = {
      slug: 'best-phones-in-nigeria',
      title: 'Best Phones in Nigeria for 2026',
      excerpt: null,
      category: 'Smartphones',
      tags: ['smartphones'],
      keywords: ['best'],
      featured_image_url: null,
      published_at: '2026-04-10T00:00:00.000Z',
      reading_time_minutes: 6,
    };

    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [priorityPost.slug],
        guidePosts: [fallbackPost, priorityPost],
      })
    );

    expect(links.length).toBeGreaterThan(0);
    expect(links[0].href).toBe(
      'https://ogabassey.com/blog/iphone-buying-guide'
    );
  });

  it('rejects same-category mismatched-brand priority guide and yields to matching fallback guide', () => {
    const mismatchedPriorityPost = {
      slug: 'samsung-galaxy-s24-ultra-buyer-guide',
      title: 'Samsung Galaxy S24 Ultra Buyer Guide',
      excerpt: 'Complete buying guide for Samsung Galaxy S24 Ultra.',
      category: 'Smartphones',
      tags: ['smartphones', 'samsung'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 5,
    };
    const matchingFallbackPost = {
      slug: 'iphone-buying-guide',
      title: 'iPhone Buying Guide',
      excerpt: 'How to choose your Apple iPhone in Nigeria.',
      category: 'Smartphones',
      tags: ['smartphones', 'apple'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-10T00:00:00.000Z',
      reading_time_minutes: 4,
    };

    const links = buildProductGuideLinks(
      makeInput({
        currentProduct: {
          slug: 'iphone-16e',
          name: 'iPhone 16e',
          price: 450_000,
          brand: 'Apple',
          condition: 'new',
          stock: 4,
          category_slug: 'smartphones',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [mismatchedPriorityPost.slug],
        guidePosts: [mismatchedPriorityPost, matchingFallbackPost],
      })
    );

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(
      'https://ogabassey.com/blog/iphone-buying-guide'
    );

    const isolatedLinks = buildProductGuideLinks(
      makeInput({
        currentProduct: {
          slug: 'iphone-16e',
          name: 'iPhone 16e',
          price: 450_000,
          brand: 'Apple',
          condition: 'new',
          stock: 4,
          category_slug: 'smartphones',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [mismatchedPriorityPost.slug],
        guidePosts: [mismatchedPriorityPost],
      })
    );
    expect(isolatedLinks).toEqual([]);
  });
});
