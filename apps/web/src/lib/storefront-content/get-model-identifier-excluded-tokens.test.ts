import { describe, expect, it } from 'vitest';
import { getExcludedModelIdentifierTokens } from './get-model-identifier-excluded-tokens';

describe('getExcludedModelIdentifierTokens', () => {
  it('excludes the configured brand from a matching model slug', () => {
    const excluded = getExcludedModelIdentifierTokens(
      {
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productSlugs: ['samsung-galaxy-s25'],
      },
      'samsung-galaxy-s25',
      new Set(['pc']),
      new Set(),
      (value) =>
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/u)
          .filter(Boolean)
    );

    expect(excluded.has('samsung')).toBe(true);
    expect(excluded.has('pc')).toBe(true);
  });
});
