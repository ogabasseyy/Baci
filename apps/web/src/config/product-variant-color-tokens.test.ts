import { describe, expect, it } from 'vitest';
import { PRODUCT_VARIANT_COLOR_TOKENS } from './product-variant-color-tokens';

describe('PRODUCT_VARIANT_COLOR_TOKENS', () => {
  it('contains stripped catalog color suffixes without model tiers', () => {
    expect(PRODUCT_VARIANT_COLOR_TOKENS.has('midnight')).toBe(true);
    expect(PRODUCT_VARIANT_COLOR_TOKENS.has('starlight')).toBe(true);
    expect(PRODUCT_VARIANT_COLOR_TOKENS.has('porcelain')).toBe(true);
    expect(PRODUCT_VARIANT_COLOR_TOKENS.has('bay')).toBe(true);
    expect(PRODUCT_VARIANT_COLOR_TOKENS.has('pro')).toBe(false);
  });
});
