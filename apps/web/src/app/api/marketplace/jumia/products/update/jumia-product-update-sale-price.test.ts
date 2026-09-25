import { describe, expect, it } from 'vitest';
import { resolveSalePrice } from './jumia-product-update-sale-price';

const mapping = {
  jumia_sale_price: 1000,
  jumia_sale_start: '2026-08-01',
  jumia_sale_end: '2026-08-31',
};

describe('resolveSalePrice', () => {
  it('returns undefined when sale price is explicitly cleared', () => {
    expect(
      resolveSalePrice({ jumia_sale_price: null }, mapping)
    ).toBeUndefined();
  });

  it('uses override price with the mapping sale window', () => {
    expect(resolveSalePrice({ jumia_sale_price: 900 }, mapping)).toEqual({
      value: 900,
      startAt: '2026-08-01',
      endAt: '2026-08-31',
    });
  });

  it('keeps the mapping price when only sale dates are overridden', () => {
    expect(
      resolveSalePrice(
        { jumia_sale_start: '2026-09-01', jumia_sale_end: '2026-09-30' },
        mapping
      )
    ).toEqual({
      value: 1000,
      startAt: '2026-09-01',
      endAt: '2026-09-30',
    });
  });

  it('returns undefined when overrides are empty', () => {
    expect(resolveSalePrice({}, mapping)).toBeUndefined();
  });
});
