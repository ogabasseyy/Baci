import { describe, expect, it } from 'vitest';
import { hasDistinctCompareIdentifierOccurrences } from './has-distinct-compare-identifier-occurrences';

describe('hasDistinctCompareIdentifierOccurrences', () => {
  it('rejects one identifier occurrence for two same-model variants', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'ipad-10-wifi-cellular-guide',
        title: 'Apple iPad 10 Wi-Fi Cellular Buyer Guide',
        excerpt: null,
        category: 'Tablets',
        tags: ['tablets'],
        keywords: ['buyer guide'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['10', '10']
    );

    expect(result).toBe(false);
  });

  it('accepts two occurrences for two same-model variants', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'ipad-10-wifi-vs-cellular',
        title: 'Apple iPad 10 Wi-Fi vs Apple iPad 10 Cellular',
        excerpt: null,
        category: 'Tablets',
        tags: ['tablets'],
        keywords: ['comparison'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['10', '10']
    );

    expect(result).toBe(true);
  });

  it('rejects repeated standalone metadata as separate compared products', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'ipad-10-wifi-cellular-guide',
        title: 'Apple iPad 10 Wi-Fi Cellular Buyer Guide',
        excerpt: 'Apple iPad 10 Wi-Fi Cellular buying advice.',
        category: 'Tablets',
        tags: ['tablets'],
        keywords: ['buyer guide'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['10', '10']
    );

    expect(result).toBe(false);
  });

  it('rejects repeated same-model mentions inside one standalone title', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'ipad-10-wifi-cellular-review',
        title:
          'Apple iPad 10 Wi-Fi Cellular Review: Is the iPad 10 Worth Buying?',
        excerpt: null,
        category: 'Tablets',
        tags: ['tablets'],
        keywords: ['buyer guide'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['10', '10']
    );

    expect(result).toBe(false);
  });

  it('inherits the model for a shorthand variant-only comparison segment', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'iphone-15-128gb-vs-256gb',
        title: 'Apple iPhone 15 128GB vs 256GB Comparison',
        excerpt: null,
        category: 'Smartphones',
        tags: ['smartphones'],
        keywords: ['comparison'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['15', '15']
    );

    expect(result).toBe(true);
  });

  it('does not inherit the model across a different branded product segment', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'iphone-15-vs-galaxy-s25',
        title: 'Apple iPhone 15 128GB vs Samsung Galaxy S25 256GB',
        excerpt: null,
        category: 'Smartphones',
        tags: ['smartphones'],
        keywords: ['comparison'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['15', '15']
    );

    expect(result).toBe(false);
  });

  it('inherits a model prefix for a tier-only comparison segment', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'iphone-15-vs-pro',
        title: 'Apple iPhone 15 vs Pro Comparison',
        excerpt: null,
        category: 'Smartphones',
        tags: ['smartphones'],
        keywords: ['comparison'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['15', '15 pro']
    );

    expect(result).toBe(true);
  });

  it('preserves conjunctions inside compared game identifiers', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'fast-and-furious-vs-gta-v',
        title: 'Fast and Furious Spy Racers vs GTA V Comparison',
        excerpt: null,
        category: 'PlayStation Games',
        tags: ['playstation'],
        keywords: ['comparison'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['fast and furious spy racers', 'gta v']
    );

    expect(result).toBe(true);
  });

  it('inherits console edition identifiers across disc and digital shorthand', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'xbox-series-x-digital-vs-disc',
        title: 'Xbox Series X Digital vs Disc Comparison',
        excerpt: null,
        category: 'Xbox',
        tags: ['xbox'],
        keywords: ['comparison'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['series x digital', 'series x disc']
    );

    expect(result).toBe(true);
  });

  it('does not reuse one longer identifier for a prefix requirement', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'xps-13-vs-xps-13-9340',
        title: 'Dell XPS 13 vs Dell XPS 13 9340 Comparison',
        excerpt: null,
        category: 'Laptops',
        tags: null,
        keywords: null,
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['xps 13', 'xps 13 9340']
    );

    expect(result).toBe(true);
    expect(
      hasDistinctCompareIdentifierOccurrences(
        {
          slug: 'xps-13-9340',
          title: 'Dell XPS 13 9340 Buyer Guide',
          excerpt: null,
          category: 'Laptops',
          tags: null,
          keywords: null,
          featured_image_url: null,
          published_at: null,
          reading_time_minutes: null,
        },
        ['xps 13', 'xps 13 9340']
      )
    ).toBe(false);
  });

  it('allows display metadata between compare identifier tokens', () => {
    const result = hasDistinctCompareIdentifierOccurrences(
      {
        slug: 'macbook-air-vs-pro',
        title:
          'Apple MacBook Air 13-inch M4 versus Apple MacBook Pro 14-inch M4',
        excerpt: null,
        category: 'Laptops',
        tags: null,
        keywords: ['comparison'],
        featured_image_url: null,
        published_at: null,
        reading_time_minutes: null,
      },
      ['air m4', 'pro m4']
    );

    expect(result).toBe(true);
  });
});
