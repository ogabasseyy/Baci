import { describe, expect, it } from 'vitest';
import { hasCleanIdentifierOccurrence } from './has-clean-identifier-occurrence';

describe('hasCleanIdentifierOccurrence brand aliases', () => {
  it('rejects a multi-token brand that overlaps the identifier', () => {
    const post = {
      slug: 'north-star-x-guide',
      title: 'North Star X buyer guide',
      excerpt: null,
      category: 'Accessories',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: null,
    };

    expect(
      hasCleanIdentifierOccurrence(post, ['star', 'x'], {
        brand: 'north star',
        requireBrandBeforeIdentifier: true,
      })
    ).toBe(false);
  });

  it('accepts a configured alias that starts the product identifier', () => {
    const post = {
      slug: 'thinkpad-t14-gen-4-buyer-guide',
      title: 'ThinkPad T14 Gen 4 buyer guide',
      excerpt: null,
      category: 'Laptops',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: null,
    };

    expect(
      hasCleanIdentifierOccurrence(post, ['thinkpad', 't14', 'gen', '4'], {
        brand: 'lenovo',
        knownBrands: ['lenovo'],
        brandAliases: { lenovo: ['lenovo', 'thinkpad'] },
        requireBrandBeforeIdentifier: true,
        allowBrandAliasOverlap: true,
      })
    ).toBe(true);
  });
});
