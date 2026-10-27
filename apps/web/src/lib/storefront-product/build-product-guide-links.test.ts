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
});
