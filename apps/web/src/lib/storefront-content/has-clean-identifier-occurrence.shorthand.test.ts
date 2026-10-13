import { describe, expect, it } from 'vitest';
import { hasCleanIdentifierOccurrence } from './has-clean-identifier-occurrence';

function post(title: string) {
  return {
    slug: 'iphone-15-pro-comparison',
    title,
    excerpt: null,
    category: 'Smartphones',
    tags: null,
    keywords: null,
    featured_image_url: null,
    published_at: null,
    reading_time_minutes: 6,
  };
}

describe('hasCleanIdentifierOccurrence shorthand discriminators', () => {
  it('rejects a shorthand model occurrence with the wrong storage variant', () => {
    const result = hasCleanIdentifierOccurrence(
      post('Apple iPhone 15 128GB vs Pro Comparison'),
      ['15', 'pro'],
      {
        brand: 'apple',
        discriminatorTokens: ['256gb'],
        requireBrandBeforeIdentifier: true,
      }
    );

    expect(result).toBe(false);
  });

  it('accepts a shorthand model occurrence with the expected storage variant', () => {
    const result = hasCleanIdentifierOccurrence(
      post('Apple iPhone 15 256GB vs Pro Comparison'),
      ['15', 'pro'],
      {
        brand: 'apple',
        discriminatorTokens: ['256gb'],
        requireBrandBeforeIdentifier: true,
      }
    );

    expect(result).toBe(true);
  });
});
