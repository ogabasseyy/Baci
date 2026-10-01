import { describe, expect, it } from 'vitest';
import { isProductVariantColorToken } from './is-product-variant-color-token';

describe('isProductVariantColorToken', () => {
  it('recognizes catalog colors without treating model tiers as colors', () => {
    expect(isProductVariantColorToken('blue')).toBe(true);
    expect(isProductVariantColorToken('midnight')).toBe(true);
    expect(isProductVariantColorToken('pro')).toBe(false);
  });
});
