import { describe, expect, it } from 'vitest';
import { selectSearchProductsByPrice } from './select-search-products-by-price';

const products = [
  { id: 'parent-cheap-option-expensive', displayPrice: 120000 },
  { id: 'parent-expensive-option-cheap', displayPrice: 90000 },
  { id: 'simple', displayPrice: 100000 },
];

describe('selectSearchProductsByPrice', () => {
  it('filters on hydrated purchasable prices before applying the result limit', () => {
    expect(selectSearchProductsByPrice(products, { max_price: 100000 }, 1))
      .toEqual([products[1]]);
    expect(selectSearchProductsByPrice(products, { min_price: 110000 }, 20))
      .toEqual([products[0]]);
  });

  it('orders by hydrated prices in either direction', () => {
    expect(selectSearchProductsByPrice(products, { sort: 'price_asc' }, 20).map(({ id }) => id))
      .toEqual(['parent-expensive-option-cheap', 'simple', 'parent-cheap-option-expensive']);
    expect(selectSearchProductsByPrice(products, { sort: 'price_desc' }, 20).map(({ id }) => id))
      .toEqual(['parent-cheap-option-expensive', 'simple', 'parent-expensive-option-cheap']);
  });

  it('excludes unconfirmed prices from ranges and sorted results', () => {
    const rows = [{ id: 'unknown', displayPrice: null }, ...products];
    expect(selectSearchProductsByPrice(rows, { max_price: 100000 }, 20).map(({ id }) => id))
      .toEqual(['parent-expensive-option-cheap', 'simple']);
    expect(selectSearchProductsByPrice(rows, { sort: 'price_desc' }, 20).map(({ id }) => id))
      .toEqual(['parent-cheap-option-expensive', 'simple', 'parent-expensive-option-cheap']);
  });
});
