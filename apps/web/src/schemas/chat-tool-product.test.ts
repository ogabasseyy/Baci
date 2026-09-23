import { expect, it } from 'vitest';
import { chatToolProductSchema } from './chat-tool-product';

const product = {
  brand: null,
  category: null,
  description: null,
  has_variants: false,
  id: 'one',
  image_url: null,
  manage_stock: false,
  name: 'Phone',
  price: 10,
  slug: null,
  status: 'active',
  stock: null,
};

it('accepts nullable catalog fields and preserves extra tool metadata', () => {
  expect(
    chatToolProductSchema.parse({ ...product, quantity: 2 })
  ).toMatchObject({ quantity: 2 });
});

it('rejects inactive products and malformed stock', () => {
  expect(
    chatToolProductSchema.safeParse({ ...product, status: 'draft' }).success
  ).toBe(false);
  expect(
    chatToolProductSchema.safeParse({ ...product, stock: 'two' }).success
  ).toBe(false);
});

it.each([
  { condition: 42 },
  { minimum_order_quantity: 0 },
  { minimum_order_quantity: 1.5 },
])('rejects malformed selection metadata %j', (metadata) => {
  expect(
    chatToolProductSchema.safeParse({ ...product, ...metadata }).success
  ).toBe(false);
});
