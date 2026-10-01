import { describe, expect, it } from 'vitest';
import { isOfferStockRow } from './related-blog-offer-stock-row';

describe('isOfferStockRow', () => {
  it('accepts object rows and rejects nullish values', () => {
    expect(isOfferStockRow({ stock_quantity: 2 })).toBe(true);
    expect(isOfferStockRow(null)).toBe(false);
    expect(isOfferStockRow(undefined)).toBe(false);
    expect(isOfferStockRow('row')).toBe(false);
  });
});
