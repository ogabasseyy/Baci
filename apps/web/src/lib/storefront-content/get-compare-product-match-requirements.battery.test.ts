import { describe, expect, it } from 'vitest';
import { getCompareProductMatchRequirements } from './get-compare-product-match-requirements';

describe('getCompareProductMatchRequirements battery variants', () => {
  it('retains mAh capacity for same-model power-bank comparisons', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'accessories',
      brands: ['Xiaomi'],
      productNames: [
        'Xiaomi 10000mAh Power Bank',
        'Xiaomi 20000mAh Power Bank',
      ],
    });

    expect(requirements).toEqual([
      {
        identifier: 'power bank',
        brand: 'xiaomi',
        discriminatorTokens: ['10000mah'],
      },
      {
        identifier: 'power bank',
        brand: 'xiaomi',
        discriminatorTokens: ['20000mah'],
      },
    ]);
  });
});
