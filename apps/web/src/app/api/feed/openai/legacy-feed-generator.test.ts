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

describe('generateOpenAIFeed', () => {
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

  it('builds canonical policy URLs and normalizes trailing base URL slashes', () => {
    const [line] = generateOpenAIFeed(
      [product({ manage_stock: false, stock: 0 })],
      merchant,
      'https://ogabassey.com/'
    );
    const parsed = parseLine(line);

    expect(parsed).toMatchObject({
      title: 'Test Phone',
      description: 'A strong phone',
      link: 'https://ogabassey.com/products/test-phone',
      merchant_url: 'https://ogabassey.com',
      return_policy_url: 'https://ogabassey.com/returns',
      shipping_policy_url: 'https://ogabassey.com/shipping',
      terms_of_service_url: 'https://ogabassey.com/terms',
      availability: 'in_stock',
      quantity: 9999,
    });
  });

  it('uses unmanaged product stock as authoritative for variants', () => {
    const lines = generateOpenAIFeed(
      [
        product({
          manage_stock: false,
          variants: [
            {
              id: 'variant-1',
              sku: 'SKU-RED',
              attributes: { color: 'Red' },
              stock_quantity: 0,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );
    const parsed = parseLine(lines[0]);

    expect(parsed).toMatchObject({
      id: 'SKU-RED',
      title: 'Test Phone - Red',
      availability: 'in_stock',
      quantity: 9999,
    });
  });

  it('reflects managed variant stock quantities', () => {
    const [line] = generateOpenAIFeed(
      [
        product({
          manage_stock: true,
          variants: [
            {
              id: 'variant-1',
              sku: 'SKU-RED',
              attributes: { color: 'Red' },
              stock_quantity: 2,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );
    const parsed = parseLine(line);

    expect(parsed).toMatchObject({
      id: 'SKU-RED',
      availability: 'in_stock',
      quantity: 2,
    });
  });

  it('excludes zero-priced variants and includes storage in title', () => {
    const lines = generateOpenAIFeed(
      [
        product({
          manage_stock: true,
          variants: [
            {
              id: 'variant-free',
              sku: 'SKU-FREE',
              attributes: { Color: 'Red', Storage: '128GB' },
              price_override: 0,
              stock_quantity: 2,
            },
            {
              id: 'variant-paid',
              sku: 'SKU-PAID',
              attributes: { Color: 'Blue', Storage: '256GB' },
              price_override: 40_000,
              stock_quantity: 3,
            },
          ],
        }),
      ],
      merchant,
      'https://ogabassey.com'
    );
    const parsed = parseLine(lines[0]);

    expect(lines).toHaveLength(1);
    expect(parsed).toMatchObject({
      id: 'SKU-PAID',
      title: 'Test Phone - Blue - 256GB',
      price: '40000.00 NGN',
    });
  });

  it('filters invalid prices and missing item identifiers', () => {
    const lines = generateOpenAIFeed(
      [
        product({ id: '', price: Number.NaN }),
        product({ id: '', sku: '', price: 50_000 }),
        product({
          id: 'product-with-variants',
          manage_stock: true,
          variants: [
            {
              id: '',
              sku: '',
              attributes: { color: 'Red' },
              price_override: 40_000,
              stock_quantity: 2,
            },
            {
              id: 'variant-valid',
              sku: 'SKU-VALID',
              attributes: { color: 'Blue', size: 'XL' },
              price_override: Number.POSITIVE_INFINITY,
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

  it('returns one JSONL line per valid product in input order', () => {
    const lines = generateOpenAIFeed(
      [
        product({ id: 'product-1' }),
        product({ id: 'product-2', name: 'Case' }),
      ],
      merchant,
      'https://ogabassey.com'
    );

    expect(lines).toHaveLength(2);
    expect(parseLine(lines[0])).toMatchObject({ id: 'product-1' });
    expect(parseLine(lines[1])).toMatchObject({ id: 'product-2' });
  });

  it('returns no lines for empty products or blank product names', () => {
    expect(generateOpenAIFeed([], merchant, 'https://ogabassey.com')).toEqual(
      []
    );
    expect(
      generateOpenAIFeed(
        [product({ name: '   ' })],
        merchant,
        'https://ogabassey.com'
      )
    ).toEqual([]);
  });

  it('emits the merchant payout currency for non-NGN merchants', () => {
    const ghMerchant: Merchant = {
      id: 'merchant-2',
      business_name: 'Accra Store',
      country: 'GH',
      payout_currency: 'GHS',
      slug: 'accra-store',
    };
    const [line] = generateOpenAIFeed(
      [product()],
      ghMerchant,
      'https://accra-store.com'
    );
    const parsed = parseLine(line);

    expect(parsed).toMatchObject({ price: '50000.00 GHS' });
  });

  it('falls back to the platform default (NGN) when payout currency is missing', () => {
    const merchantWithoutCurrency: Merchant = {
      id: 'merchant-1',
      business_name: 'Ogabassey',
      slug: 'ogabassey',
    };
    const [line] = generateOpenAIFeed(
      [product()],
      merchantWithoutCurrency,
      'https://ogabassey.com'
    );
    const parsed = parseLine(line);

    expect(parsed).toMatchObject({ price: '50000.00 NGN' });
  });
});
