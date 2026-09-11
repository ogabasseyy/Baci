import { expect, it } from 'vitest';
import { selectFeedFamilyVariant } from './select-feed-family-variant';

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
