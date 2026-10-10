import { describe, expect, it } from 'vitest';
import { isBlogFeaturedVariantKey } from './is-blog-featured-variant-key';

describe('isBlogFeaturedVariantKey', () => {
  it.each([
    'landscape_16x9',
    'standard_4x3',
    'square_1x1',
  ])('accepts the known variant key: %s', (value) => {
    expect(isBlogFeaturedVariantKey(value)).toBe(true);
  });

  it.each([
    'thumb',
    '',
    'LANDSCAPE_16X9',
    'landscape-16x9',
  ])('rejects unknown variant keys: %s', (value) => {
    expect(isBlogFeaturedVariantKey(value)).toBe(false);
  });
});
