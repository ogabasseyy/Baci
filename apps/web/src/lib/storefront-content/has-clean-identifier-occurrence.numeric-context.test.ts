import { describe, expect, it } from 'vitest';
import { hasCleanIdentifierOccurrence } from './has-clean-identifier-occurrence';

describe('hasCleanIdentifierOccurrence numeric context', () => {
  it('rejects an accessory list count with only distant model-family context', () => {
    const post = {
      slug: 'apple-iphone-accessories-15-cases',
      title: 'Apple iPhone Accessories: 15 Cases to Buy',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: null,
    };

    const result = hasCleanIdentifierOccurrence(post, ['15'], {
      brand: 'apple',
    });

    expect(result).toBe(false);
  });
});
