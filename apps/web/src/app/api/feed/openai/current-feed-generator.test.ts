import { describe, expect, it } from 'vitest';
import { generateCurrentOpenAIProductFeed } from './current-feed-generator';
import type { CurrentOpenAIFeedItem, Merchant, Product } from './feed-types';

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

function parseLine(line: string | undefined): CurrentOpenAIFeedItem {
  if (!line) {
    throw new Error('Expected current feed line to be generated.');
  }

  return JSON.parse(line) as CurrentOpenAIFeedItem;
}

describe('generateCurrentOpenAIProductFeed', () => {
  it('builds current feed items with untracked availability', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [product({ manage_stock: false, stock: 0 })],
      merchant,
      'https://ogabassey.com'
    );
    const parsed = parseLine(line);

    expect(parsed).toMatchObject({
      id: 'product-1',
      title: 'Test Phone',
      description: { plain: 'A strong phone' },
      url: 'https://ogabassey.com/products/test-phone',
      media: [{ type: 'image', url: 'https://cdn.example.com/phone.jpg' }],
    });
    expect(parsed.variants[0]).toMatchObject({
      id: 'product-1',
      availability: {
        available: true,
        status: 'in_stock',
        quantity: null,
      },
    });
  });

  it('treats null manage_stock as untracked availability', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [
        product({
          manage_stock: null,
          stock: 0,
          stock_quantity: 0,
          variants: [
            {
              id: 'variant-red',
              sku: 'TP-RED',
              attributes: { color: 'Red' },
              price_override: 50_000,
              stock_quantity: 0,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );
    const parsed = parseLine(line);

    expect(parsed.variants[0]).toMatchObject({
      id: 'TP-RED',
      title: 'Test Phone - Red',
      price: { amount: 50_000, currency: 'NGN' },
      availability: {
        available: true,
        status: 'in_stock',
        quantity: null,
      },
    });
    expect(parsed.url).toBe('https://ogabassey.com/products/test-phone');
    expect(parsed.media).toEqual([
      { type: 'image', url: 'https://cdn.example.com/phone.jpg' },
    ]);
  });

  it('skips products when all variant offers have non-positive prices', () => {
    const lines = generateCurrentOpenAIProductFeed(
      [
        product({
          price: 50_000,
          variants: [
            {
              id: 'variant-free',
              attributes: { color: 'Free' },
              price_override: 0,
              stock_quantity: 2,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );

    expect(lines).toEqual([]);
  });

  it('filters out products with blank names', () => {
    expect(
      generateCurrentOpenAIProductFeed(
        [product({ name: '   ' })],
        merchant,
        'https://ogabassey.com'
      )
    ).toEqual([]);
  });

  it('emits tracked in-stock availability', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [product({ manage_stock: true, stock: 5, stock_quantity: 5 })],
      merchant,
      'https://ogabassey.com'
    );
    const parsed = parseLine(line);

    expect(parsed.variants?.[0]).toMatchObject({
      availability: {
        available: true,
        status: 'in_stock',
        quantity: 5,
      },
    });
  });

  it('emits tracked out-of-stock availability', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [product({ manage_stock: true, stock: 0, stock_quantity: 0 })],
      merchant,
      'https://ogabassey.com'
    );
    const parsed = parseLine(line);

    expect(parsed.variants?.[0]).toMatchObject({
      availability: {
        available: false,
        status: 'out_of_stock',
        quantity: 0,
      },
    });
  });

  it('falls back to NGN and truncates plain descriptions', () => {
    const merchantWithoutCurrency: Merchant = {
      id: 'merchant-1',
      business_name: 'Ogabassey',
      slug: 'ogabassey',
    };
    const longDescription = `<p>${'a'.repeat(5001)}</p>`;
    const [line] = generateCurrentOpenAIProductFeed(
      [product({ description: longDescription })],
      merchantWithoutCurrency,
      'https://ogabassey.com'
    );
    const parsed = parseLine(line);

    expect(parsed.description.plain).toHaveLength(5000);
    expect(parsed.variants[0].price).toEqual({
      amount: 50_000,
      currency: 'NGN',
    });
  });

  it('emits the merchant payout currency for non-NGN merchants', () => {
    const ghMerchant: Merchant = {
      id: 'merchant-2',
      business_name: 'Accra Store',
      country: 'GH',
      payout_currency: 'GHS',
      slug: 'accra-store',
    };
    const [line] = generateCurrentOpenAIProductFeed(
      [product()],
      ghMerchant,
      'https://accra-store.com'
    );
    const parsed = parseLine(line);

    expect(parsed.variants[0].price).toEqual({
      amount: 50_000,
      currency: 'GHS',
    });
  });
});
