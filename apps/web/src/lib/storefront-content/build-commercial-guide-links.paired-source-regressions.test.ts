import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';
import type { PublishedClusterPost } from './content-cluster-types';

const NEWER = '2026-04-12T09:00:00.000Z';
const OLDER = '2026-04-01T09:00:00.000Z';

function post(
  slug: string,
  title: string,
  category: string,
  publishedAt: string
): PublishedClusterPost {
  return {
    slug,
    title,
    excerpt: 'Product-specific comparison and buying advice.',
    category,
    tags: [category.toLowerCase(), 'buyer guide'],
    keywords: ['buyer guide'],
    featured_image_url: null,
    published_at: publishedAt,
    reading_time_minutes: 6,
  };
}

function firstHref(input: Parameters<typeof buildCommercialGuideLinks>[0]) {
  return buildCommercialGuideLinks(input)[0]?.href;
}

describe('buildCommercialGuideLinks paired-source regressions', () => {
  it('uses a paired slug to identify a generic compare display name', () => {
    const href = firstHref({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'apple-vs-samsung-smartphone-guide',
          'Apple vs Samsung Smartphone Comparison',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-vs-galaxy-s25',
          'Apple iPhone 15 vs Samsung Galaxy S25 Comparison',
          'Smartphones',
          OLDER
        ),
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple', 'Samsung'],
        productNames: ['Apple iPhone 15', 'Samsung Smartphone'],
        productSlugs: ['apple-iphone-15', 'samsung-galaxy-s25'],
      },
    });

    expect(href).toBe('https://ogabassey.com/blog/iphone-15-vs-galaxy-s25');
  });

  it('uses paired PDP slug storage to reject a newer sibling guide', () => {
    const href = firstHref({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'iphone-15-128gb-guide',
          'Apple iPhone 15 128GB Buyer Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-256gb-guide',
          'Apple iPhone 15 256GB Buyer Guide',
          'Smartphones',
          OLDER
        ),
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15'],
        productSlugs: ['apple-iphone-15-256gb'],
      },
    });

    expect(href).toBe('https://ogabassey.com/blog/iphone-15-256gb-guide');
  });

  it('distinguishes watch case dimensions on PDP guides', () => {
    const href = firstHref({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'apple-watch-9-41mm-guide',
          'Apple Watch Series 9 41mm Buyer Guide',
          'Smartwatches',
          NEWER
        ),
        post(
          'apple-watch-9-45mm-guide',
          'Apple Watch Series 9 45mm Buyer Guide',
          'Smartwatches',
          OLDER
        ),
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartwatches',
        brands: ['Apple'],
        productNames: ['Apple Watch Series 9 45mm'],
      },
    });

    expect(href).toBe('https://ogabassey.com/blog/apple-watch-9-45mm-guide');
  });

  it('distinguishes GPS and Bluetooth same-model comparisons', () => {
    const href = firstHref({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'watch-9-lte-vs-cellular',
          'Samsung Watch 9 LTE vs Samsung Watch 9 Cellular Comparison',
          'Smartwatches',
          NEWER
        ),
        post(
          'watch-9-gps-vs-bluetooth',
          'Samsung Watch 9 GPS vs Samsung Watch 9 Bluetooth Comparison',
          'Smartwatches',
          OLDER
        ),
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartwatches',
        brands: ['Samsung'],
        productNames: ['Samsung Watch 9 GPS', 'Samsung Watch 9 BT'],
      },
    });

    expect(href).toBe('https://ogabassey.com/blog/watch-9-gps-vs-bluetooth');
  });

  it('prefers a model-family prefix supplied by the paired slug', () => {
    const href = firstHref({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post('hp-15-guide', 'HP 15 Buyer Guide', 'Laptops', NEWER),
        post(
          'hp-pavilion-15-guide',
          'HP Pavilion 15 Buyer Guide',
          'Laptops',
          OLDER
        ),
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'laptops',
        brands: ['HP'],
        productNames: ['HP 15'],
        productSlugs: ['hp-pavilion-15'],
      },
    });

    expect(href).toBe('https://ogabassey.com/blog/hp-pavilion-15-guide');
  });

  it('matches a product tier inherited by a shorthand comparison', () => {
    const href = firstHref({
      storeUrl: 'https://ogabassey.com',
      posts: [
        post(
          'iphone-15-comparison-guide',
          'Apple iPhone 15 Comparison Guide',
          'Smartphones',
          NEWER
        ),
        post(
          'iphone-15-vs-pro',
          'Apple iPhone 15 vs Pro Comparison',
          'Smartphones',
          OLDER
        ),
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15', 'Apple iPhone 15 Pro'],
      },
    });

    expect(href).toBe('https://ogabassey.com/blog/iphone-15-vs-pro');
  });
});
