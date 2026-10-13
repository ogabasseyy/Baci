import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import type {
  BuildCommercialGuideLinksContext,
  PublishedClusterPost,
} from './content-cluster-types';

function post(
  title: string,
  publishedAt: string,
  category: string
): PublishedClusterPost {
  return {
    slug: title.toLowerCase().replace(/[^a-z0-9]+/gu, '-'),
    title,
    excerpt: null,
    category,
    tags: null,
    keywords: null,
    featured_image_url: null,
    published_at: publishedAt,
    reading_time_minutes: null,
  };
}

function rankedTitles(
  context: BuildCommercialGuideLinksContext,
  titles: [olderExact: string, newerWrong: string]
) {
  return buildCommercialGuideLinks({
    storeUrl: 'https://ogabassey.com',
    context,
    posts: [
      post(titles[0], '2026-01-01T00:00:00.000Z', context.categorySlug),
      post(titles[1], '2026-02-01T00:00:00.000Z', context.categorySlug),
    ],
  }).map((link) => link.title);
}

describe('buildCommercialGuideLinks semantic normalization', () => {
  it('ranks the matching AMD HS processor guide above a newer sibling CPU guide', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'gaming-laptops',
        brands: ['Asus'],
        productNames: ['ASUS ROG Zephyrus G14 Ryzen 7 7840HS RTX 4060'],
      },
      [
        'ASUS ROG Zephyrus G14 Ryzen 7 7840HS RTX 4060 Buyer Guide',
        'ASUS ROG Zephyrus G14 Ryzen 7 8845HS RTX 4060 Buyer Guide',
      ]
    );

    expect(result[0]).toBe(
      'ASUS ROG Zephyrus G14 Ryzen 7 7840HS RTX 4060 Buyer Guide'
    );
  });

  it('ranks the matching DDR-labelled RAM guide above a newer sibling-memory guide', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Lenovo'],
        productNames: ['Lenovo ThinkPad T14 16GB DDR5 512GB SSD'],
      },
      [
        'Lenovo ThinkPad T14 16GB DDR5 512GB SSD Buyer Guide',
        'Lenovo ThinkPad T14 32GB DDR5 512GB SSD Buyer Guide',
      ]
    );

    expect(result[0]).toBe(
      'Lenovo ThinkPad T14 16GB DDR5 512GB SSD Buyer Guide'
    );
  });

  it('matches a base laptop guide when the catalog GPU tail includes NVIDIA GeForce', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['Dell'],
        productNames: ['Dell G15 Core i7 NVIDIA GeForce RTX 4060'],
      },
      ['Dell G15 Buyer Guide', 'Dell G16 Buyer Guide']
    );

    expect(result[0]).toBe('Dell G15 Buyer Guide');
  });

  it('does not treat the pronoun us as an iPhone region discriminator', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 US'],
      },
      [
        'Apple iPhone 15 US Version Buyer Guide',
        'Let Us Compare Apple iPhone 15',
      ]
    );

    expect(result[0]).toBe('Apple iPhone 15 US Version Buyer Guide');
  });

  it('does not treat Black Friday as a black product finish', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 Black'],
      },
      [
        'Apple iPhone 15 Black Buyer Guide',
        'Black Friday Apple iPhone 15 Buyer Guide',
      ]
    );

    expect(result[0]).toBe('Apple iPhone 15 Black Buyer Guide');
  });

  it('canonicalizes ordinal generations before USB-C connector metadata', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'earbuds',
        brands: ['Apple'],
        productNames: ['Apple AirPods Pro 2nd Generation USB-C'],
      },
      ['Apple AirPods Pro 2 Buyer Guide', 'Apple AirPods Pro 3 Buyer Guide']
    );

    expect(result[0]).toBe('Apple AirPods Pro 2 Buyer Guide');
  });

  it('does not treat a listicle count as a numeric iPhone model', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15'],
      },
      ['Apple iPhone 15 Buyer Guide', 'Apple iPhone: Top 15 Accessories']
    );

    expect(result[0]).toBe('Apple iPhone 15 Buyer Guide');
  });

  it.each([
    'True',
    'Truly',
  ])('ranks the exact wireless audio model when its descriptor starts with %s', (qualifier) => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'audio',
        brands: ['Sony'],
        productNames: [`Sony WF-1000XM5 ${qualifier} Wireless Earbuds`],
      },
      ['Sony WF-1000XM5 Buyer Guide', 'Sony WF-1000XM4 Buyer Guide']
    );

    expect(result[0]).toBe('Sony WF-1000XM5 Buyer Guide');
  });

  it('ranks the exact monitor model after display descriptors are removed', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'monitors',
        brands: ['LG'],
        productNames: ['LG 27GR95QE-B 27 inch OLED 240Hz Gaming Monitor'],
      },
      ['LG 27GR95QE-B Buyer Guide', 'LG 27GS95QE-B Buyer Guide']
    );

    expect(result[0]).toBe('LG 27GR95QE-B Buyer Guide');
  });

  it('ranks the base AirPods guide when charging-case metadata is present', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'earbuds',
        brands: ['Apple'],
        productNames: [
          'Apple AirPods Pro 2nd Generation with MagSafe Case USB-C',
        ],
      },
      ['Apple AirPods Pro 2 Buyer Guide', 'Apple AirPods Pro 3 Buyer Guide']
    );

    expect(result[0]).toBe('Apple AirPods Pro 2 Buyer Guide');
  });

  it('ranks a Switch OLED console guide above a newer Switch Lite guide', () => {
    const result = rankedTitles(
      {
        pageKind: 'product',
        categorySlug: 'nintendo-switch',
        brands: ['Nintendo'],
        productNames: ['Nintendo Switch OLED Model White'],
      },
      ['Nintendo Switch OLED Buyer Guide', 'Nintendo Switch Lite Buyer Guide']
    );

    expect(result[0]).toBe('Nintendo Switch OLED Buyer Guide');
  });
});
