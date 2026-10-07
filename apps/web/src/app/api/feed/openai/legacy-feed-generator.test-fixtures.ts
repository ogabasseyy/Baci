import type { Merchant, Product } from './feed-types';

export function createLegacyFeedTestFixtures() {
  const merchant: Merchant = {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    payout_currency: 'NGN',
    slug: 'ogabassey',
  };

  function product(overrides: Partial<Product> = {}): Product {
    return {
      id: 'product-1',
      name: 'Test Phone',
      description: '<p>A strong phone</p>',
      slug: 'test-phone',
      price: 50_000,
      images: ['https://cdn.example.com/phone.jpg'],
      stock: 5,
      ...overrides,
    };
  }

  function parseLine(line: string | undefined): Record<string, unknown> {
    if (!line) {
      throw new Error('Expected feed line to be generated.');
    }

    return JSON.parse(line) as Record<string, unknown>;
  }

  return { merchant, parseLine, product };
}
