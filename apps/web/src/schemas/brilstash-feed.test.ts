import { describe, expect, it } from 'vitest';
import { brilstashProductSchema } from './brilstash-feed';
import { parseBrilStashFeedQuery } from './brilstash-feed-query';

const fixture = {
  external_id: 'test-offer',
  product_url: 'https://shop.example.invalid/p',
  title: 'Phone',
  description:
    'Condition: New. Specifications: 128GB. Box contents: Phone. Warranty: 30 days.',
  category: 'Test mapping',
  price_naira: 25000.5,
  stock_quantity: 0,
  images: [{ url: 'https://images.example.invalid/p.jpg' }],
};

describe('BrilStash product contract', () => {
  it('accepts numeric naira prices and zero stock', () => {
    expect(brilstashProductSchema.parse(fixture)).toEqual(fixture);
  });

  it.each([
    { price_naira: '25000.50' },
    { price_naira: Number.POSITIVE_INFINITY },
    { stock_quantity: 0.5 },
    { stock_quantity: -1 },
    { images: [] },
    {
      images: Array.from({ length: 11 }, (_, i) => ({
        url: `https://images.example.invalid/${i}`,
      })),
    },
    { images: [{ url: 'http://images.example.invalid/p.jpg' }] },
    { images: [{ url: 'https://images.example.invalid:65536/p.jpg' }] },
    { images: [{ url: 'https://images.example.invalid/p.jpg#crop' }] },
    { product_url: 'https://user:pass@shop.example.invalid/p' },
    { internal_merchant_id: 'private' },
    { description: '<b>Phone</b>' },
  ])('rejects invalid or extra wire fields: %j', (change) => {
    expect(
      brilstashProductSchema.safeParse({ ...fixture, ...change }).success
    ).toBe(false);
  });
});

describe('BrilStash query contract', () => {
  it('applies provisional defaults and parses inclusive price filter input', () => {
    expect(parseBrilStashFeedQuery(new URLSearchParams())).toEqual({
      page: 1,
      limit: 100,
      min_price: 0,
    });
    expect(
      parseBrilStashFeedQuery(
        new URLSearchParams('page=2&limit=3&min_price=400000.50')
      )
    ).toEqual({
      page: 2,
      limit: 3,
      min_price: 400000.5,
    });
  });

  it.each([
    'page=0',
    'page=1.5',
    'limit=101',
    'limit=2&limit=3',
    'min_price=1e9',
    'min_price=-1',
    'min_price=',
    'unknown=1',
    'page=99999999999999999',
  ])('rejects malformed or ambiguous query %s', (query) =>
    expect(parseBrilStashFeedQuery(new URLSearchParams(query))).toBeNull());
});
