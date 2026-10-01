import { describe, expect, it } from 'vitest';
import { hasCleanIdentifierOccurrence } from './has-clean-identifier-occurrence';

describe('hasCleanIdentifierOccurrence comparison discriminators', () => {
  it('requires the complete ordered variant discriminator', () => {
    const hybridPost = {
      slug: 'iphone-15-hybrid-storage-guide',
      title: 'iPhone 15 8GB 128GB storage guide',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 6,
    };
    const completePost = {
      ...hybridPost,
      slug: 'iphone-15-esim-storage-guide',
      title: 'Apple iPhone 15 128GB eSIM storage guide',
    };

    expect(
      hasCleanIdentifierOccurrence(hybridPost, ['15'], {
        brand: 'apple',
        knownBrands: ['apple'],
        discriminatorTokens: ['128gb', 'esim'],
      })
    ).toBe(false);
    expect(
      hasCleanIdentifierOccurrence(completePost, ['15'], {
        brand: 'apple',
        knownBrands: ['apple'],
        discriminatorTokens: ['128gb', 'esim'],
      })
    ).toBe(true);
  });

  it('does not borrow discriminators from the other side of a comparison', () => {
    const post = {
      slug: 'iphone-15-vs-galaxy-s25-configurations',
      title:
        'Apple iPhone 15 6GB 128GB eSIM vs Samsung Galaxy S25 8GB 256GB physical SIM',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 6,
    };

    expect(
      hasCleanIdentifierOccurrence(post, ['15'], {
        brand: 'apple',
        knownBrands: ['apple', 'samsung'],
        discriminatorTokens: ['256gb', 'physical', 'sim'],
      })
    ).toBe(false);
    expect(
      hasCleanIdentifierOccurrence(post, ['15'], {
        brand: 'apple',
        knownBrands: ['apple', 'samsung'],
        discriminatorTokens: ['128gb', 'esim'],
      })
    ).toBe(true);
  });

  it('treats conjunctions as comparison boundaries for discriminators', () => {
    const orPost = {
      slug: 'iphone-15-or-galaxy-s25',
      title: 'Apple iPhone 15 128GB or Samsung Galaxy S25 256GB Buyer Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 6,
    };
    const andPost = {
      ...orPost,
      slug: 'iphone-and-galaxy',
      title:
        'Apple iPhone 15 128GB eSIM and Samsung Galaxy S25 256GB physical SIM',
    };

    expect(
      hasCleanIdentifierOccurrence(orPost, ['15'], {
        brand: 'apple',
        knownBrands: ['apple', 'samsung'],
        discriminatorTokens: ['256gb'],
      })
    ).toBe(false);
    expect(
      hasCleanIdentifierOccurrence(andPost, ['15'], {
        brand: 'apple',
        knownBrands: ['apple', 'samsung'],
        discriminatorTokens: ['256gb', 'physical', 'sim'],
      })
    ).toBe(false);
  });

  it('treats slash-separated products as comparison boundaries', () => {
    const post = {
      slug: 'iphone-slash-galaxy',
      title: 'Apple iPhone 15 128GB / Samsung Galaxy S25 256GB Comparison',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 6,
    };

    expect(
      hasCleanIdentifierOccurrence(post, ['15'], {
        brand: 'apple',
        knownBrands: ['apple', 'samsung'],
        discriminatorTokens: ['256gb'],
      })
    ).toBe(false);
  });

  it('treats ampersand-separated products as comparison boundaries', () => {
    const post = {
      slug: 'iphone-and-galaxy-symbol',
      title: 'Apple iPhone 15 128GB & Samsung Galaxy S25 256GB Comparison',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 6,
    };

    expect(
      hasCleanIdentifierOccurrence(post, ['15'], {
        brand: 'apple',
        knownBrands: ['apple', 'samsung'],
        discriminatorTokens: ['256gb'],
      })
    ).toBe(false);
  });

  it('keeps exact models before punctuation-separated listicle counts', () => {
    const post = {
      slug: 'iphone-15-reasons',
      title: 'Apple iPhone 15 — 7 Reasons to Buy',
      excerpt: null,
      category: 'Smartphones',
      tags: null,
      keywords: null,
      featured_image_url: null,
      published_at: null,
      reading_time_minutes: 6,
    };

    expect(hasCleanIdentifierOccurrence(post, ['iphone', '15'])).toBe(true);
  });
});
