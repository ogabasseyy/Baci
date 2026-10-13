import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks', () => {
  it('selects only matching published guides for a compare page', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'best-phones-in-nigeria',
          title: 'Best Phones in Nigeria',
          excerpt: 'Budget and flagship phone picks.',
          category: 'Smartphones',
          tags: ['smartphones', 'budget', 'iphone'],
          keywords: ['android', 'battery'],
          featured_image_url: null,
          published_at: '2026-04-10T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-vs-samsung-buying-guide',
          title: 'Apple vs Samsung Buying Guide',
          excerpt: 'Which ecosystem fits you.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'samsung'],
          keywords: ['iphone', 'galaxy'],
          featured_image_url: null,
          published_at: '2026-04-09T09:00:00.000Z',
          reading_time_minutes: 5,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['apple', 'samsung'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/apple-vs-samsung-buying-guide',
      'https://ogabassey.com/blog/best-phones-in-nigeria',
    ]);
  });

  it('caps the result set at three guides', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: Array.from({ length: 4 }, (_, index) => ({
        slug: `smartphone-guide-${index + 1}`,
        title: `Best Smartphones ${index + 1}`,
        excerpt: 'Affordable smartphone picks.',
        category: 'Smartphones',
        tags: ['smartphones'],
        keywords: ['android'],
        featured_image_url: null,
        published_at: `2026-04-0${index + 1}T09:00:00.000Z`,
        reading_time_minutes: 5,
      })),
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
      },
    });

    expect(links).toHaveLength(3);
  });

  it('boosts a model guide without treating the brand token as a product match', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'itel-buyer-guide',
          title: 'Itel Phones Buyer Guide',
          excerpt: 'How to choose an Itel phone.',
          category: 'Smartphones',
          tags: ['smartphones', 'itel'],
          keywords: ['battery'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'itel-power-80-buyer-guide',
          title: 'Itel Power 80 Buyer Guide',
          excerpt: 'Battery life, 4G limits and camera expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'itel', 'power 80'],
          keywords: ['battery'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Itel'],
        productSlugs: ['itel-power-80-128gb-4gb'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/itel-power-80-buyer-guide',
      'https://ogabassey.com/blog/itel-buyer-guide',
    ]);
  });

  it('derives compare brand aliases from product slugs', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-buyer-guide',
          title: 'Samsung Phones Buyer Guide',
          excerpt: 'How to choose a Samsung phone.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'samsung-galaxy-z-trifold-guide',
          title: 'Samsung Galaxy Z Trifold Buyer Guide',
          excerpt: 'What to know about the Galaxy Z Trifold.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'trifold'],
          keywords: ['foldable'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        productSlugs: ['samsung-galaxy-z-trifold'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/samsung-galaxy-z-trifold-guide',
      'https://ogabassey.com/blog/samsung-buyer-guide',
    ]);
  });

  it('requires the family marker when scoring numeric generations', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'tecno-camon-40-guide',
          title: 'Tecno Camon 40 Buyer Guide',
          excerpt: 'Camon 40 camera and battery expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'tecno', 'camon', '40'],
          keywords: ['camera'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'tecno-spark-40-guide',
          title: 'Tecno Spark 40 Buyer Guide',
          excerpt: 'Spark 40 battery and camera expectations.',
          category: 'Smartphones',
          tags: ['smartphones', 'tecno', 'spark', '40'],
          keywords: ['battery'],
          published_at: '2026-04-01T09:00:00.000Z',
          featured_image_url: null,
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
        brands: ['Tecno'],
        productSlugs: ['tecno-spark-40'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/tecno-spark-40-guide',
      'https://ogabassey.com/blog/tecno-camon-40-guide',
    ]);
  });

  it('requires the Xbox Series marker before boosting a letter model', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'xbox-buyer-guide',
          title: 'Xbox Buyer Guide',
          excerpt: "Microsoft's console buying advice.",
          category: 'Xbox',
          tags: ['xbox', 'console'],
          keywords: ['game pass'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'xbox-series-s-guide',
          title: 'Xbox Series S Buyer Guide',
          excerpt: 'Series S performance and storage expectations.',
          category: 'Xbox',
          tags: ['xbox', 'series s'],
          keywords: ['console'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'xbox',
        brands: ['Xbox'],
        productSlugs: ['xbox-series-s'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/xbox-series-s-guide',
      'https://ogabassey.com/blog/xbox-buyer-guide',
    ]);
  });

  it('treats malformed published dates as least-recent entries', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'recent-guide',
          title: 'Best Phones in Nigeria Right Now',
          excerpt: 'Recent smartphone picks.',
          category: 'Smartphones',
          tags: ['smartphones'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-10T09:00:00.000Z',
          reading_time_minutes: 5,
        },
        {
          slug: 'invalid-date-guide',
          title: 'Best Phones in Nigeria on a Budget',
          excerpt: 'Budget smartphone picks.',
          category: 'Smartphones',
          tags: ['smartphones'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: 'not-a-date',
          reading_time_minutes: 5,
        },
      ],
      context: {
        pageKind: 'category',
        categorySlug: 'smartphones',
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/recent-guide',
      'https://ogabassey.com/blog/invalid-date-guide',
    ]);
  });
});
