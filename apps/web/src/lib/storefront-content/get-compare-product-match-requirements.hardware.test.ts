import { describe, expect, it } from 'vitest';
import { getCompareProductMatchRequirements } from './get-compare-product-match-requirements';

describe('getCompareProductMatchRequirements laptop hardware', () => {
  it('retains distinct Core Ultra tiers for same-model comparisons', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: [
        'Dell XPS 13 9340 Core Ultra 7',
        'Dell XPS 13 9340 Core Ultra 5',
      ],
    });

    expect(requirements).toEqual([
      {
        identifier: 'xps 13 9340',
        brand: 'dell',
        discriminatorTokens: ['coreultra7'],
      },
      {
        identifier: 'xps 13 9340',
        brand: 'dell',
        discriminatorTokens: ['coreultra5'],
      },
    ]);
  });

  it('retains distinct RTX tiers for same-model comparisons', () => {
    const requirements = getCompareProductMatchRequirements({
      pageKind: 'compare',
      categorySlug: 'gaming-laptops',
      brands: ['ASUS'],
      productNames: ['ASUS ROG G16 RTX 4060', 'ASUS ROG G16 RTX 4070'],
    });

    expect(requirements).toEqual([
      {
        identifier: 'rog g16',
        brand: 'asus',
        discriminatorTokens: ['rtx4060'],
      },
      {
        identifier: 'rog g16',
        brand: 'asus',
        discriminatorTokens: ['rtx4070'],
      },
    ]);
  });
});
