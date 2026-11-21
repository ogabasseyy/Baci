import { expect, it } from 'vitest';
import { brilStashPageResultSchema } from './brilstash-page';

const id = '30000000-0000-4000-8000-000000000001';
const product = {
  external_id: 'listing',
  product_url: 'https://shop.example.invalid/products/phone',
  title: 'Phone',
  description: 'Approved description.',
  category: 'Phones',
  price_naira: 0.01,
  stock_quantity: 0,
  images: [{ url: 'https://images.example.invalid/phone.jpg' }],
};
const page = {
  status: 'ok',
  products: Array.from({ length: 7 }, (_, i) => ({
    ...product,
    external_id: `listing-${i}`,
  })),
  totalCount: 7,
  totalPages: 1,
  generationId: id,
  credentialId: id,
  payloadDigest: 'a'.repeat(64),
};

it('accepts a complete pilot page and status-only failures', () => {
  expect(brilStashPageResultSchema.parse(page)).toEqual(page);
  for (const status of [
    'unauthorized',
    'ingress_unavailable',
    'unavailable',
    'invalid_query',
  ]) {
    expect(brilStashPageResultSchema.parse({ status })).toEqual({ status });
    expect(
      brilStashPageResultSchema.safeParse({
        status,
        payloadDigest: page.payloadDigest,
      }).success
    ).toBe(false);
  }
});

it.each([
  { totalCount: 8 },
  { totalPages: -1 },
  { totalPages: 1.25 },
  { products: [...page.products, product] },
  { generationId: 'bad' },
  { payloadDigest: 'A'.repeat(64) },
])('rejects invalid page metadata %#', (override) => {
  expect(
    brilStashPageResultSchema.safeParse({ ...page, ...override }).success
  ).toBe(false);
});
