import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks compare context', () => {
  it('ranks a guide covering both compared models above a one-model guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-galaxy-s25-buyer-guide',
          title: 'Samsung Galaxy S25 Buyer Guide',
          excerpt: 'What to know before buying the Galaxy S25.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'galaxy s25'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'samsung-galaxy-s25-vs-s24-guide',
          title: 'Samsung Galaxy S25 vs S24 Buyer Guide',
          excerpt: 'Compare the Galaxy S25 and S24 before you buy.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'galaxy s25', 'galaxy s24'],
          keywords: ['comparison', 'android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productSlugs: ['samsung-galaxy-s25', 'samsung-galaxy-s24'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/samsung-galaxy-s25-vs-s24-guide',
      'https://ogabassey.com/blog/samsung-galaxy-s25-buyer-guide',
    ]);
  });

  it('keeps compared brands distinct when model identifiers collide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'apple-watch-ultra-buyer-guide',
          title: 'Apple Watch Ultra Buyer Guide',
          excerpt: 'What to know before buying Apple Watch Ultra.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'watch ultra'],
          keywords: ['battery'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-watch-ultra-vs-samsung-watch-ultra',
          title: 'Apple Watch Ultra vs Samsung Watch Ultra Buyer Guide',
          excerpt: 'Compare Apple Watch Ultra and Samsung Watch Ultra.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'samsung', 'watch ultra'],
          keywords: ['comparison', 'battery'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartwatches',
        brands: ['Apple', 'Samsung'],
        productSlugs: ['apple-watch-ultra-49mm', 'samsung-watch-ultra'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/apple-watch-ultra-vs-samsung-watch-ultra',
      'https://ogabassey.com/blog/apple-watch-ultra-buyer-guide',
    ]);
  });

  it('does not boost an iPhone 15 Pro guide for the base iPhone 15 product', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'iphone-15-pro-buyer-guide',
          title: 'iPhone 15 Pro Buyer Guide',
          excerpt: 'What to know before buying the iPhone 15 Pro.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'iphone 15 pro'],
          keywords: ['camera'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'iphone-15-buyer-guide',
          title: 'iPhone 15 Buyer Guide',
          excerpt:
            'What to know before buying the iPhone 15, including whether the iPhone 15 Pro is worth it.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'iphone 15'],
          keywords: ['camera'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productSlugs: ['iphone-15'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/iphone-15-buyer-guide',
      'https://ogabassey.com/blog/iphone-15-pro-buyer-guide',
    ]);
  });

  it('does not boost an Apple Watch Ultra 2 guide for the base Ultra product', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'apple-watch-ultra-2-buyer-guide',
          title: 'Apple Watch Ultra 2 Buyer Guide',
          excerpt: 'What to know before buying the Apple Watch Ultra 2.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'watch ultra 2'],
          keywords: ['battery'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-watch-ultra-buyer-guide',
          title: 'Apple Watch Ultra Buyer Guide',
          excerpt: 'What to know before buying the Apple Watch Ultra.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'watch ultra'],
          keywords: ['battery'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartwatches',
        brands: ['Apple'],
        productSlugs: ['apple-watch-ultra'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/apple-watch-ultra-buyer-guide',
      'https://ogabassey.com/blog/apple-watch-ultra-2-buyer-guide',
    ]);
  });

  it('preserves a plus-model guide when the catalog slug lost the plus sign', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-galaxy-s24-buyer-guide',
          title: 'Samsung Galaxy S24 Buyer Guide',
          excerpt: 'What to know before buying the Galaxy S24.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'galaxy s24'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'samsung-galaxy-s24-plus-buyer-guide',
          title: 'Samsung Galaxy S24 Plus Buyer Guide',
          excerpt: 'What to know before buying the Galaxy S24 Plus.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'galaxy s24 plus'],
          keywords: ['android'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productNames: ['Samsung Galaxy S24+'],
        productSlugs: ['samsung-galaxy-s24-2'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/samsung-galaxy-s24-plus-buyer-guide',
      'https://ogabassey.com/blog/samsung-galaxy-s24-buyer-guide',
    ]);
  });

  it('requires a coherent model occurrence instead of scattered tokens', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'apple-watch-ultra-2-buyer-guide',
          title: 'Apple Watch Ultra 2 Buyer Guide',
          excerpt: 'What to know before buying the Apple Watch Ultra 2.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple', 'watch ultra 2'],
          keywords: ['battery'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'apple-watch-buyer-guide',
          title: 'Apple Watch Buyer Guide',
          excerpt: 'Ultra-long battery life can reach 2 days.',
          category: 'Smartwatches',
          tags: ['smartwatches', 'apple'],
          keywords: ['battery'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'smartwatches',
        brands: ['Apple'],
        productSlugs: ['apple-watch-ultra-2'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/apple-watch-ultra-2-buyer-guide',
      'https://ogabassey.com/blog/apple-watch-buyer-guide',
    ]);
  });

  it('does not boost a generic numeric VR guide for Meta Quest 3', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'top-3-meta-vr-headsets',
          title: 'Top 3 Meta VR Headsets',
          excerpt: 'A current shortlist for virtual reality buyers.',
          category: 'VR Headsets',
          tags: ['vr', 'meta', 'headsets'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'meta-quest-3-buyer-guide',
          title: 'Meta Quest 3 Buyer Guide',
          excerpt: 'What to know before buying the Meta Quest 3.',
          category: 'VR Headsets',
          tags: ['vr', 'meta', 'quest 3'],
          keywords: ['buying guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'product',
        categorySlug: 'vr-headsets',
        brands: ['Meta'],
        productNames: ['Meta Quest 3'],
        productSlugs: ['meta-quest-3'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/meta-quest-3-buyer-guide',
      'https://ogabassey.com/blog/top-3-meta-vr-headsets',
    ]);
  });
});
