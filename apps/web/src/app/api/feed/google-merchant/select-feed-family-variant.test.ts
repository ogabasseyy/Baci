import { expect, it } from 'vitest';
import { selectFeedFamilyVariant } from './select-feed-family-variant';

it('ranks valid in-stock candidates ahead of sold-out candidates after excluding invalid prices', () => {
  const product = {
    id: 'p',
    name: 'Phone',
    description: '',
    price: 10,
    stock: 0,
    manage_stock: true,
  };
  const variants = [
    {
      id: 'invalid',
      condition: 'new' as const,
      price_override: 0,
      stock_quantity: 1,
    },
    {
      id: 'sold-out',
      condition: 'new' as const,
      price_override: 20,
      stock_quantity: 0,
    },
    {
      id: 'available',
      condition: 'new' as const,
      price_override: 30,
      stock_quantity: 1,
    },
  ];
  expect(selectFeedFamilyVariant(product, variants)?.id).toBe('available');
});

it.each([
  -1,
  0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
])('skips an in-stock preferred SKU with invalid price %s', (price) => {
  const product = {
    id: 'p',
    name: 'Phone',
    description: '',
    price: 10,
    stock: 0,
    manage_stock: true,
  };
  const valid = {
    id: 'valid',
    condition: 'new' as const,
    price_override: 20,
    stock_quantity: 1,
  };
  const invalid = { ...valid, id: 'invalid', price_override: price };
  expect(selectFeedFamilyVariant(product, [invalid, valid])?.id).toBe('valid');
  expect(selectFeedFamilyVariant(product, [invalid])).toBeUndefined();
});

it('falls back to a valid sold-out SKU but never a zero price', () => {
  const product = {
    id: 'p',
    name: 'Phone',
    description: '',
    price: 10,
    stock: 0,
    manage_stock: true,
  };
  const variant = {
    id: 'v',
    condition: 'new' as const,
    price_override: 20,
    stock_quantity: 0,
  };
  expect(selectFeedFamilyVariant(product, [variant])).toEqual(variant);
  expect(
    selectFeedFamilyVariant(product, [{ ...variant, price_override: 0 }])
  ).toBeUndefined();
});
