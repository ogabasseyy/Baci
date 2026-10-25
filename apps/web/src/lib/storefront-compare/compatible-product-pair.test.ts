import { describe, expect, it } from 'vitest';
import { isCompatibleProductPair } from './compatible-product-pair';

describe('isCompatibleProductPair', () => {
  it('retains real same-type alternatives and rejects self comparisons', () => {
    const left = { name: 'JBL Go 3', slug: 'jbl-go-3' };
    expect(
      isCompatibleProductPair(left, { name: 'JBL Go 4', slug: 'jbl-go-4' })
    ).toBe(true);
    expect(isCompatibleProductPair(left, left)).toBe(false);
  });
  it('recognizes aliases from an array of manufacturer part numbers and punctuation', () => {
    expect(
      isCompatibleProductPair(
        {
          name: 'Laptop A',
          slug: 'a',
          product_key_specs: { part_numbers: ['AB-123', 'Other'] },
        },
        { name: 'Laptop B', slug: 'b', product_key_specs: { mpn: 'ab123' } }
      )
    ).toBe(false);
  });
  it('rejects exact hardware aliases even when part-number data is absent', () => {
    expect(
      isCompatibleProductPair(
        { name: 'HP Omen Transcend 14-fb1018nia', slug: 'hp-omen' },
        { name: 'Omen Transcend Laptop 14-fb1018nia', slug: 'omen' }
      )
    ).toBe(false);
  });
  it('does not treat family TV names as exact-model comparisons', () => {
    expect(
      isCompatibleProductPair(
        { name: 'LG OLED Smart TV', slug: 'lg-oled' },
        { name: 'LG UHD 4K HDR Smart TV', slug: 'lg-uhd' }
      )
    ).toBe(false);
  });
});
