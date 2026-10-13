import { describe, expect, it } from 'vitest';
import { getCompareProductMatchRequirements } from './get-compare-product-match-requirements';

describe('getCompareProductMatchRequirements region and brand variants', () => {
  it('retains regional suffixes as compare discriminators', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['Apple iPhone 15 US', 'Apple iPhone 15 UK'],
    });

    expect(requirements).toEqual([
      { identifier: '15', brand: 'apple', discriminatorTokens: ['us'] },
      { identifier: '15', brand: 'apple', discriminatorTokens: ['uk'] },
    ]);
  });

  it('prefers each aligned explicit brand over compatibility brands in names', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'accessories',
      brands: ['Apple', 'Samsung'],
      productBrands: ['Samsung', 'Apple'],
      productNames: [
        'Samsung Case for Apple iPhone 15',
        'Apple Case for Samsung Galaxy S25',
      ],
    });

    expect(requirements.map(({ brand }) => brand)).toEqual([
      'samsung',
      'apple',
    ]);
  });
});
