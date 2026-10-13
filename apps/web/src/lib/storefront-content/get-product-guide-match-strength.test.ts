import { describe, expect, it } from 'vitest';
import { getProductGuideMatchStrength } from './get-product-guide-match-strength';

function post(title: string) {
  return {
    slug: 'iphone-15-guide',
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

const baseInput = {
  inferredTokens: ['apple', 'iphone', '15', 'buyer', 'guide'],
  inferredBrands: ['apple'],
  identifiers: ['15'],
  normalizedBrands: ['apple'],
  brandAliases: {},
  bindBrand: true,
  hasBrandMatch: true,
  discriminatorTokens: ['256gb'],
};

describe('getProductGuideMatchStrength', () => {
  it('scores an exact PDP variant above its base model guide', () => {
    const exact = getProductGuideMatchStrength({
      ...baseInput,
      post: post('Apple iPhone 15 256GB Buyer Guide'),
      inferredTokens: ['apple', 'iphone', '15', '256gb', 'buyer', 'guide'],
    });
    const base = getProductGuideMatchStrength({
      ...baseInput,
      post: post('Apple iPhone 15 Buyer Guide'),
    });

    expect(exact).toBe(2);
    expect(base).toBe(1);
  });

  it('does not give exact strength when a PDP guide omits a variant group', () => {
    const strength = getProductGuideMatchStrength({
      ...baseInput,
      post: post('Apple iPad 10 256GB Buyer Guide'),
      inferredTokens: ['apple', 'ipad', '10', '256gb', 'buyer', 'guide'],
      identifiers: ['10'],
      discriminatorTokens: ['256gb', 'wifi'],
    });

    expect(strength).toBe(1);
  });
});
