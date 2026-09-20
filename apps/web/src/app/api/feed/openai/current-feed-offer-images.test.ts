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

describe('generateCurrentOpenAIProductFeed offer images', () => {
  it('uses verified feed manifest images as ordered media', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [
        product({
          images: ['https://cdn.example.com/stale-product-image.jpg'],
        }),
      ],
      merchant,
      'https://ogabassey.com',
      {
        'product-1': [
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            verified_url: 'https://cdn.example.com/manifest-side.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: false,
            position: 1,
          },
        ],
      }
    );
    const parsed = parseLine(line);

    expect(parsed.media).toEqual([
      { type: 'image', url: 'https://cdn.example.com/manifest-front.jpg' },
      { type: 'image', url: 'https://cdn.example.com/manifest-side.jpg' },
    ]);
  });

  it('excludes offer-claimed images from product-level media', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [
        product({
          offers: [{ images: ['https://cdn.example.com/manifest-side.jpg'] }],
        }),
      ],
      merchant,
      'https://ogabassey.com',
      {
        'product-1': [
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            verified_url: 'https://cdn.example.com/manifest-side.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: false,
            position: 1,
          },
        ],
      }
    );
    const parsed = parseLine(line);

    expect(parsed.media).toEqual([
      { type: 'image', url: 'https://cdn.example.com/manifest-front.jpg' },
    ]);
  });

  it('does not restore an offer-claimed primary through the raw fallback', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [
        product({
          images: ['https://cdn.example.com/manifest-front.jpg'],
          offers: [{ images: ['https://cdn.example.com/manifest-front.jpg'] }],
        }),
      ],
      merchant,
      'https://ogabassey.com',
      {
        'product-1': [
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
        ],
      }
    );
    const parsed = parseLine(line);

    expect(parsed.media).toEqual([]);
  });

  it('excludes a relative-claimed absolute product image from the raw fallback', () => {
    const [line] = generateCurrentOpenAIProductFeed(
      [
        product({
          images: [
            'https://cdn.example.com/images/used.jpg',
            'https://cdn.example.com/phone.jpg',
          ],
          offers: [{ images: ['/images/used.jpg'] }],
        }),
      ],
      merchant,
      'https://ogabassey.com',
      {}
    );
    const parsed = parseLine(line);

    expect(parsed.media).toEqual([
      { type: 'image', url: 'https://cdn.example.com/phone.jpg' },
    ]);
  });
});
