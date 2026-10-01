import { describe, expect, it } from 'vitest';
import { getProtectedModelFamilyTokens } from './get-protected-model-family-tokens';

describe('getProtectedModelFamilyTokens', () => {
  it('preserves pad for Redmi tablet products', () => {
    const tokens = getProtectedModelFamilyTokens(
      {
        categorySlug: 'tablets',
        brands: ['Redmi'],
        productSlugs: ['redmi-pad-pro'],
      },
      (value) =>
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/u)
          .filter(Boolean)
    );
    expect(tokens.has('pad')).toBe(true);
  });
});
