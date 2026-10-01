import { describe, expect, it } from 'vitest';
import { buildCommercialGuideLinks } from './build-commercial-guide-links';

describe('buildCommercialGuideLinks numeric compare brands', () => {
  it('binds numeric compare identifiers to their source brands', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'samsung-galaxy-s25-15-reasons',
          title: 'Samsung Galaxy S25: 15 reasons to buy',
          excerpt: 'A Samsung buyer guide for the Galaxy S25.',
          category: 'Smartphones',
          tags: ['smartphones', 'samsung', 'galaxy s25'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'iphone-15-vs-galaxy-s25-guide',
          title: 'Apple iPhone 15 vs Samsung Galaxy S25 Buyer Guide',
          excerpt: 'Compare Apple iPhone 15 and Samsung Galaxy S25.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'samsung', 'comparison'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        productNames: ['Apple iPhone 15', 'Samsung Galaxy S25'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/iphone-15-vs-galaxy-s25-guide',
      'https://ogabassey.com/blog/samsung-galaxy-s25-15-reasons',
    ]);
  });

  it('uses direct context brands for compare models outside configured aliases', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'nokia-buying-guide',
          title: 'Nokia Phones Buyer Guide',
          excerpt: 'How to choose a Nokia phone.',
          category: 'Smartphones',
          tags: ['smartphones', 'nokia'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'nokia-6310-vs-8210-guide',
          title: 'Nokia 6310 vs Nokia 8210 Buyer Guide',
          excerpt: 'Compare the Nokia 6310 and Nokia 8210.',
          category: 'Smartphones',
          tags: ['smartphones', 'nokia', 'comparison'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Nokia'],
        productNames: ['Nokia 6310', 'Nokia 8210'],
      },
    });

    expect(links[0]?.href).toBe(
      'https://ogabassey.com/blog/nokia-6310-vs-8210-guide'
    );
  });

  it('ranks a split-capacity comparison above a newer single-variant guide', () => {
    const links = buildCommercialGuideLinks({
      storeUrl: 'https://ogabassey.com',
      posts: [
        {
          slug: 'iphone-15-256gb-guide',
          title: 'Apple iPhone 15 256 GB Buyer Guide',
          excerpt: 'How to choose the 256 GB iPhone 15.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'iphone 15'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-12T09:00:00.000Z',
          reading_time_minutes: 6,
        },
        {
          slug: 'iphone-15-128gb-vs-256gb',
          title: 'Apple iPhone 15 128 GB vs Apple iPhone 15 256 GB Buyer Guide',
          excerpt: 'Compare the 128 GB and 256 GB iPhone 15.',
          category: 'Smartphones',
          tags: ['smartphones', 'apple', 'iphone 15', 'comparison'],
          keywords: ['buyer guide'],
          featured_image_url: null,
          published_at: '2026-04-01T09:00:00.000Z',
          reading_time_minutes: 6,
        },
      ],
      context: {
        pageKind: 'compare',
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productNames: ['Apple iPhone 15 128 GB', 'Apple iPhone 15 256 GB'],
      },
    });

    expect(links.map((link) => link.href)).toEqual([
      'https://ogabassey.com/blog/iphone-15-128gb-vs-256gb',
      'https://ogabassey.com/blog/iphone-15-256gb-guide',
    ]);
  });
});
