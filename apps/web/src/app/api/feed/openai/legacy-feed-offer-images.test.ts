import { describe, expect, it } from 'vitest';
import type { Merchant, Product } from './feed-types';
import { generateOpenAIFeed } from './legacy-feed-generator';

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

describe('generateOpenAIFeed offer images', () => {
  it('prefers verified feed manifest images over product image fallbacks', () => {
    const [line] = generateOpenAIFeed(
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

    expect(parsed.image_link).toBe(
      'https://cdn.example.com/manifest-front.jpg'
    );
    expect(parsed.additional_image_links).toEqual([
      'https://cdn.example.com/manifest-side.jpg',
    ]);
  });

  it('excludes offer-claimed images from product-level image links', () => {
    const [line] = generateOpenAIFeed(
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

    expect(parsed.image_link).toBe(
      'https://cdn.example.com/manifest-front.jpg'
    );
    expect(parsed.additional_image_links).toEqual([]);
  });

  it('does not restore an offer-claimed primary through raw fallbacks', () => {
    const [line] = generateOpenAIFeed(
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

    expect(parsed.image_link).toBe('');
    expect(parsed.additional_image_links).toEqual([]);
  });

  it('excludes a relative-claimed absolute product image from raw fallbacks', () => {
    const [line] = generateOpenAIFeed(
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

    expect(parsed.image_link).toBe('');
    expect(parsed.additional_image_links).toEqual([
      'https://cdn.example.com/phone.jpg',
    ]);
  });
});
