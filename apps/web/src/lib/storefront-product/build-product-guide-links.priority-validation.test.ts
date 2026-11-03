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

describe('buildProductGuideLinks - priority validation and ranking', () => {
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

  it('preserves same-category platform guide for PDP with unmapped publisher brand (EA Sports on PS5)', () => {
    const ps5BuyerGuide = {
      slug: 'best-ps5-games-buyer-guide',
      title: 'Best PS5 Games Buyer Guide in Nigeria (2026)',
      excerpt: 'Complete buying guide for PlayStation 5 games.',
      category: 'PlayStation 5',
      tags: ['playstation-5', 'ps5', 'gaming'],
      keywords: ['buyer guide', 'ps5', 'games'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 6,
    };

    // Priority placement
    const priorityLinks = buildProductGuideLinks(
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
        priorityGuidePostSlugs: [ps5BuyerGuide.slug],
        guidePosts: [ps5BuyerGuide],
      })
    );
    expect(priorityLinks).toHaveLength(1);
    expect(priorityLinks[0].href).toBe(
      'https://ogabassey.com/blog/best-ps5-games-buyer-guide'
    );

    // Fallback placement (non-priority)
    const fallbackLinks = buildProductGuideLinks(
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
        priorityGuidePostSlugs: [],
        guidePosts: [ps5BuyerGuide],
      })
    );
    expect(fallbackLinks).toHaveLength(1);
    expect(fallbackLinks[0].href).toBe(
      'https://ogabassey.com/blog/best-ps5-games-buyer-guide'
    );
  });

  it('preserves general category buyer guide for priority guide when product brand is unmapped', () => {
    const generalPhoneGuide = {
      slug: 'best-phones-in-nigeria',
      title: 'Best Phones in Nigeria for 2026',
      excerpt: 'Comprehensive buyer guide for all smartphones.',
      category: 'Smartphones',
      tags: ['smartphones'],
      keywords: ['buyer guide'],
      featured_image_url: null,
      published_at: '2026-04-01T00:00:00.000Z',
      reading_time_minutes: 5,
    };

    const links = buildProductGuideLinks(
      makeInput({
        currentProduct: {
          slug: 'unbranded-feature-phone',
          name: 'Unbranded Feature Phone',
          price: 25_000,
          brand: 'GenericBrandXYZ',
          condition: 'new',
          stock: 10,
          category_slug: 'smartphones',
          product_key_specs: {},
        },
        priorityGuidePostSlugs: [generalPhoneGuide.slug],
        guidePosts: [generalPhoneGuide],
      })
    );
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(
      'https://ogabassey.com/blog/best-phones-in-nigeria'
    );
  });
});
