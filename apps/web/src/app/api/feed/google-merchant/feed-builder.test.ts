import { describe, expect, it, vi } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import {
  type FeedMerchant,
  type FeedOffer,
  type FeedProduct,
  generateGoogleMerchantFeed,
} from './feed-builder';

// ---------- helpers ----------
function product(overrides: Partial<FeedProduct> = {}): FeedProduct {
  return {
    id: 'prod-1',
    name: 'Test Product',
    description: 'A test product',
    slug: 'test-product',
    price: 100,
    stock: 10,
    manage_stock: true,
    condition: 'new',
    ...overrides,
  };
}

function merchant(overrides: Partial<FeedMerchant> = {}): FeedMerchant {
  return {
    id: 'merchant-1',
    business_name: 'Test Store',
    slug: 'test-store',
    payout_currency: 'NGN',
    ...overrides,
  };
}

function manifestEntry(
  overrides: Partial<FeedImageManifestEntry> = {}
): FeedImageManifestEntry {
  return {
    verified_url: 'https://cdn.example.com/products/test.jpg',
    verified_format: 'jpeg',
    status: 'verified',
    is_primary: true,
    position: 0,
    ...overrides,
  };
}

const BASE_URL = 'https://ogabassey.com';

function decodeXmlText(value: string) {
  return value.replaceAll('&amp;', '&');
}

function extractLinkQueryParams(xml: string) {
  return Array.from(xml.matchAll(/<g:link>(.*?)<\/g:link>/g)).map((match) => {
    const url = new URL(decodeXmlText(match[1]));
    return Object.fromEntries(url.searchParams.entries());
  });
}

function extractItemXml(xml: string, id: string) {
  const items = xml.match(/ {4}<item>\n[\s\S]*?\n {4}<\/item>/g) ?? [];
  const item = items.find((candidate) =>
    candidate.includes(`<g:id>${id}</g:id>`)
  );

  return item ?? '';
}

// ---------- image_link guarantees ----------
describe('generateGoogleMerchantFeed — image_link guarantees', () => {
  it('emits verified primary image URL in g:image_link', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({
          verified_url: 'https://cdn.example.com/products/phone.jpg',
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain(
      '<g:image_link>https://cdn.example.com/products/phone.jpg</g:image_link>'
    );
  });

  it('never emits blank g:image_link', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {};
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toContain('<g:image_link></g:image_link>');
    expect(xml).not.toContain('<g:image_link/>');
  });

  it('excludes entire product item when no verified primary image exists', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({
          status: 'missing',
          verified_url: null,
          is_primary: true,
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toContain('<g:id>prod-1</g:id>');
    expect(xml).not.toContain('<item>');
  });

  it('excludes product when manifest has no entries for it', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {};
    const xml = generateGoogleMerchantFeed(
      [product({ id: 'no-image-product' })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toContain('<g:id>no-image-product</g:id>');
  });

  it('never emits raw AVIF URLs in output', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({
          verified_url: 'https://cdn.example.com/products/phone.jpg',
          verified_format: 'jpeg',
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toMatch(/\.avif/i);
  });

  it('preserves verified WebP URLs (no forced conversion)', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({
          verified_url: 'https://cdn.example.com/products/phone.webp',
          verified_format: 'webp',
          is_primary: true,
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain(
      '<g:image_link>https://cdn.example.com/products/phone.webp</g:image_link>'
    );
  });
});

// ---------- additional_image_link guarantees ----------
describe('generateGoogleMerchantFeed — additional_image_link guarantees', () => {
  it('emits verified additional images', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({
          is_primary: true,
          position: 0,
          verified_url: 'https://cdn.example.com/main.jpg',
        }),
        manifestEntry({
          is_primary: false,
          position: 0,
          verified_url: 'https://cdn.example.com/extra1.jpg',
        }),
        manifestEntry({
          is_primary: false,
          position: 1,
          verified_url: 'https://cdn.example.com/extra2.png',
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain(
      '<g:additional_image_link>https://cdn.example.com/extra1.jpg</g:additional_image_link>'
    );
    expect(xml).toContain(
      '<g:additional_image_link>https://cdn.example.com/extra2.png</g:additional_image_link>'
    );
  });

  it('omits unverified additional images instead of emitting broken URLs', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({
          is_primary: true,
          position: 0,
          verified_url: 'https://cdn.example.com/main.jpg',
        }),
        manifestEntry({
          is_primary: false,
          position: 0,
          status: 'missing',
          verified_url: null,
        }),
        manifestEntry({
          is_primary: false,
          position: 1,
          verified_url: 'https://cdn.example.com/good.jpg',
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    // Only the good additional image should appear
    const additionalCount = (xml.match(/<g:additional_image_link>/g) || [])
      .length;
    expect(additionalCount).toBe(1);
    expect(xml).toContain(
      '<g:additional_image_link>https://cdn.example.com/good.jpg</g:additional_image_link>'
    );
  });

  it('emits no additional_image_link when all additional entries are unverified', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({ is_primary: true, position: 0 }),
        manifestEntry({
          is_primary: false,
          position: 0,
          status: 'missing',
          verified_url: null,
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toContain('<g:additional_image_link>');
  });
});

// ---------- feed structure ----------
describe('generateGoogleMerchantFeed — feed structure', () => {
  it('enriches descriptions with the key specs Merchant Center flagged as missing', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry()],
    };
    const xml = generateGoogleMerchantFeed(
      [
        product({
          description: 'A fast flagship phone.',
          color: 'Black',
          product_key_specs: {
            screen_size_inches: 6.7,
            display_resolution: '1290 x 2796',
            ram_gb: 8,
            storage_gb: 256,
            main_camera_mp: 48,
            front_camera_mp: 12,
            weight_g: 190,
          },
        }),
      ],
      merchant(),
      BASE_URL,
      imageManifest
    );

    expect(xml).toContain('Key details: Colour: Black');
    expect(xml.indexOf('Key details:')).toBeLessThan(
      xml.indexOf('A fast flagship phone.')
    );
    expect(xml).toContain('Colour: Black');
    expect(xml).toContain('Screen size: 6.7 inches');
    expect(xml).toContain('Screen resolution: 1290 x 2796');
    expect(xml).toContain('RAM: 8GB');
    expect(xml).toContain('Storage capacity: 256GB');
    expect(xml).toContain('Rear camera resolution: 48MP');
    expect(xml).toContain('Front camera resolution: 12MP');
    expect(xml).toContain('Weight: 190g');
  });

  it('does not add key-details fragments when product specs are absent', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry()],
      'prod-2': [
        manifestEntry({
          verified_url: 'https://cdn.example.com/prod-2.jpg',
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [
        product({
          description: 'A clean product description without structured specs.',
          product_key_specs: undefined,
        }),
        product({
          id: 'prod-2',
          slug: 'prod-2',
          description: 'Another clean product description.',
          product_key_specs: {},
        }),
      ],
      merchant(),
      BASE_URL,
      imageManifest
    );

    expect(xml).not.toContain('Key details:');
    expect(xml).not.toContain('Colour:');
    expect(xml).not.toContain('Screen size:');
    expect(xml).not.toContain('Screen resolution:');
    expect(xml).not.toContain('RAM:');
    expect(xml).not.toContain('Storage capacity:');
    expect(xml).not.toContain('Rear camera resolution:');
    expect(xml).not.toContain('Front camera resolution:');
    expect(xml).not.toContain('Weight:');
  });

  it('includes multiple products with verified images', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [
        manifestEntry({
          is_primary: true,
          verified_url: 'https://cdn.example.com/p1.jpg',
        }),
      ],
      'prod-2': [
        manifestEntry({
          is_primary: true,
          verified_url: 'https://cdn.example.com/p2.png',
        }),
      ],
    };
    const xml = generateGoogleMerchantFeed(
      [
        product({ id: 'prod-1', name: 'Product 1' }),
        product({ id: 'prod-2', name: 'Product 2' }),
      ],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<g:id>prod-1</g:id>');
    expect(xml).toContain('<g:id>prod-2</g:id>');
  });

  it('excludes products without valid price', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ price: 0 })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toContain('<item>');
  });

  it('excludes products without name', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ name: '' })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toContain('<item>');
  });

  it('generates valid XML envelope', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {};
    const xml = generateGoogleMerchantFeed(
      [],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain('</channel>');
    expect(xml).toContain('</rss>');
  });

  it('does not produce double-slash in product URL when baseUrl has trailing slash', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      'https://ogabassey.com/',
      imageManifest
    );
    expect(xml).toContain(
      '<g:link>https://ogabassey.com/products/test-product</g:link>'
    );
    expect(xml).not.toContain('//products');
  });

  it('performs zero network calls (no fetch/HEAD in feed generation)', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('fetch should not be called'));

    try {
      const imageManifest: Record<string, FeedImageManifestEntry[]> = {
        'prod-1': [manifestEntry({ is_primary: true })],
      };
      generateGoogleMerchantFeed(
        [product()],
        merchant(),
        BASE_URL,
        imageManifest
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('escapes XML special characters in product fields', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [
        product({
          name: 'Phone <Pro> & "Max"',
          description: "It's the best <phone> ever & more",
        }),
      ],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('&lt;Pro&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;Max&quot;');
    expect(xml).not.toContain('<Pro>');
  });

  it('sets identifier_exists to yes when GTIN is present', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ gtin: '0123456789012' })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<g:identifier_exists>yes</g:identifier_exists>');
  });

  it('sets identifier_exists to yes when MPN and brand are both present', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ mpn: 'MPN-123', brand: 'Samsung' })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<g:identifier_exists>yes</g:identifier_exists>');
  });

  it('sets identifier_exists to no when only brand is present (no GTIN or MPN)', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ gtin: undefined, mpn: undefined, brand: 'Samsung' })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
  });

  it('sets identifier_exists to yes when MPN is present and brand falls back to business_name', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ gtin: undefined, mpn: 'MPN-456', brand: undefined })],
      merchant({ business_name: 'Ogabassey' }),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<g:identifier_exists>yes</g:identifier_exists>');
  });

  it('sets identifier_exists to no when GTIN, MPN, and brand are all missing', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ gtin: undefined, mpn: undefined, brand: undefined })],
      merchant({ business_name: '' }),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
  });

  it('prefers normalized category data for g:product_type', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [
        product({
          category: 'Fallback Text',
          categories: { name: 'Phones', slug: 'phones' },
          category_slug: 'phones',
        }),
      ],
      merchant(),
      BASE_URL,
      imageManifest
    );

    expect(xml).toContain('<g:product_type>Phones</g:product_type>');
    expect(xml).not.toContain('<g:product_type>Fallback Text</g:product_type>');
  });
});

// ---------- stock / availability ----------
describe('generateGoogleMerchantFeed — stock and availability', () => {
  const defaultManifest: Record<string, FeedImageManifestEntry[]> = {
    'prod-1': [manifestEntry({ is_primary: true })],
  };

  it('emits in_stock with quantity 9999 when manage_stock is false', () => {
    const xml = generateGoogleMerchantFeed(
      [product({ stock: 0, manage_stock: false })],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('<g:quantity>9999</g:quantity>');
  });

  it('emits canonical custom-domain links and unmanaged stock availability', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          id: 'product-1',
          name: 'Riversong Motive 5T Smart Watch',
          slug: 'riversong-motive-5t-smart-watch',
          category: 'Smartwatches',
          categories: { name: 'Smartwatches', slug: 'smartwatches' },
          price: 30_600,
          stock: 0,
          stock_quantity: 0,
          manage_stock: false,
        }),
      ],
      merchant({
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        payout_currency: 'NGN',
      }),
      'https://ogabassey.com',
      {
        'product-1': [
          manifestEntry({
            verified_url: 'https://cdn.ogabassey.com/products/watch.jpg',
            is_primary: true,
          }),
        ],
      }
    );

    expect(xml).toContain(
      '<g:link>https://ogabassey.com/smartwatches/riversong-motive-5t-smart-watch</g:link>'
    );
    expect(xml).not.toContain('https://ogabassey.com/ogabassey/');
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('<g:quantity>9999</g:quantity>');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ] as const)('emits in_stock with quantity 9999 when manage_stock is %s', (_label, manageStock) => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          stock: 0,
          stock_quantity: 0,
          manage_stock: manageStock,
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('<g:quantity>9999</g:quantity>');
  });

  it('uses stock_quantity over legacy stock when both are present', () => {
    const xml = generateGoogleMerchantFeed(
      [product({ stock: 0, stock_quantity: 50 })],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('<g:quantity>50</g:quantity>');
  });

  it('emits out_of_stock when tracked stock is 0 and stock_quantity is undefined', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          stock: 0,
          stock_quantity: undefined,
          manage_stock: true,
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>');
    expect(xml).toContain('<g:quantity>0</g:quantity>');
  });
});

// ---------- multi-condition offers ----------
describe('generateGoogleMerchantFeed — multi-condition offers', () => {
  const defaultManifest: Record<string, FeedImageManifestEntry[]> = {
    'prod-1': [manifestEntry({ is_primary: true })],
  };

  it('emits both base item and offer item for products with offers', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-1',
              condition: 'used',
              price: 710000,
              stock_quantity: 9999,
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    // Base item uses product id
    expect(xml).toContain('<g:id>prod-1</g:id>');
    // Offer item uses offer id
    expect(xml).toContain('<g:id>offer-1</g:id>');
    // Two <item> blocks total
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(2);
  });

  it('offer item has correct fields', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-1',
              condition: 'used',
              price: 710000,
              stock_quantity: 9999,
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    // Offer id
    expect(xml).toContain('<g:id>offer-1</g:id>');
    // Item group id links back to product
    expect(xml).toContain('<g:item_group_id>prod-1</g:item_group_id>');
    // Condition
    expect(xml).toContain('<g:condition>used</g:condition>');
    // Price
    expect(xml).toContain('<g:price>710000.00 NGN</g:price>');
    // Link with condition query param
    expect(xml).toContain('?condition=used</g:link>');
    // Canonical link without query param
    expect(xml).toContain(
      '<g:canonical_link>https://ogabassey.com/products/test-product</g:canonical_link>'
    );
  });

  it('emits quantity 0 instead of NaN when an offer stock quantity is missing', () => {
    const offerWithoutStockQuantity: Omit<FeedOffer, 'stock_quantity'> = {
      id: 'offer-missing-stock',
      condition: 'used',
      price: 710000,
    };

    const xml = generateGoogleMerchantFeed(
      [
        product({
          has_condition_offers: true,
          offers: [offerWithoutStockQuantity],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:id>offer-missing-stock</g:id>');
    expect(xml).toContain('<g:quantity>0</g:quantity>');
    expect(xml).not.toContain('NaN');
  });

  it('maps open_box condition to "refurbished" in GMC output', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-ob',
              condition: 'open_box',
              price: 500000,
              stock_quantity: 5,
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    // The link should still use the original condition value
    expect(xml).toContain('?condition=open_box</g:link>');
    // But the GMC condition element should be "refurbished"
    const refurbishedMatches =
      xml.match(/<g:condition>refurbished<\/g:condition>/g) || [];
    expect(refurbishedMatches.length).toBe(1);
    // No "open_box" in any g:condition element
    expect(xml).not.toContain('<g:condition>open_box</g:condition>');
  });

  it('products without offers emit exactly one item (backward compatibility)', () => {
    const xml = generateGoogleMerchantFeed(
      [product()],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(1);
    expect(xml).not.toContain('<g:item_group_id>');
    expect(xml).not.toContain('<g:canonical_link>');
  });

  it('products with empty offers array emit exactly one item', () => {
    const xml = generateGoogleMerchantFeed(
      [product({ has_condition_offers: true, offers: [] })],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(1);
  });
});

describe('generateGoogleMerchantFeed — conditioned variants', () => {
  const defaultManifest: Record<string, FeedImageManifestEntry[]> = {
    'prod-1': [manifestEntry({ is_primary: true })],
  };

  it('emits one GMC row per conditioned variant when the rollout flag is enabled', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-new-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { connectivity: 'WiFi', storage: '128GB' },
            },
            {
              id: 'variant-used-256',
              condition: 'used',
              price_override: 600000,
              stock_quantity: 2,
              attributes: {
                connectivity: 'WiFi+Cellular',
                storage: '256GB',
              },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:id>variant-new-128</g:id>');
    expect(xml).toContain('<g:id>variant-used-256</g:id>');
    expect((xml.match(/<item>/g) || []).length).toBe(2);
    expect(xml).toContain('<g:item_group_id>prod-1</g:item_group_id>');
    expect(extractLinkQueryParams(xml)).toEqual(
      expect.arrayContaining([
        {
          variantId: 'variant-new-128',
          condition: 'new',
          connectivity: 'WiFi',
          storage: '128GB',
        },
        {
          variantId: 'variant-used-256',
          condition: 'used',
          connectivity: 'WiFi+Cellular',
          storage: '256GB',
        },
      ])
    );
    expect(xml).toContain(
      '<g:canonical_link>https://ogabassey.com/products/test-product</g:canonical_link>'
    );
  });

  it('emits structured product_detail fields for variant-level specs', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          color: 'Black',
          price: 700000,
          product_key_specs: {
            screen_size_inches: 6.8,
            display_resolution: '3200 x 1440 (QHD+)',
            ram_gb: 12,
            storage_gb: 256,
            main_camera_mp: 108,
            front_camera_mp: 40,
            weight_g: 229,
          },
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-black-512',
              condition: 'used',
              price_override: 650000,
              stock_quantity: 3,
              attributes: {
                color: 'Phantom Black',
                ram: '12GB',
                storage: '512GB',
              },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      { 'prod-1': [manifestEntry({ variant_id: 'variant-black-512' })] }
    );
    const itemXml = extractItemXml(xml, 'variant-black-512');

    expect(itemXml).toContain('<g:color>Phantom Black</g:color>');
    expect(itemXml).toContain('<g:product_detail>');
    expect(itemXml).toContain(
      '<g:attribute_name>Screen resolution</g:attribute_name>'
    );
    expect(itemXml).toContain(
      '<g:attribute_value>3200 x 1440 (QHD+)</g:attribute_value>'
    );
    expect(itemXml).toContain(
      '<g:attribute_name>Storage capacity</g:attribute_name>'
    );
    expect(itemXml).toContain('<g:attribute_value>512GB</g:attribute_value>');
    expect(itemXml).toContain(
      '<g:attribute_name>Front camera resolution</g:attribute_name>'
    );
    expect(itemXml).toContain('<g:attribute_value>40MP</g:attribute_value>');
    expect(itemXml).not.toContain(
      '<g:attribute_value>256GB</g:attribute_value>'
    );
  });

  it('emits sku_matrix variant rows when the merchant flag is omitted', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-new-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { storage: '128GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: undefined }),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:id>variant-new-128</g:id>');
    expect(xml).toContain('<g:item_group_id>prod-1</g:item_group_id>');
    expect((xml.match(/<item>/g) || []).length).toBe(1);
  });

  it('ignores non-string variant attributes in titles and links', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-new-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: {
                storage: '128GB',
                channels: ['retail'],
                rank: 1,
              } as unknown as Record<string, string>,
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:title>Test Product - 128GB - New</g:title>');
    expect(extractLinkQueryParams(xml)).toEqual([
      {
        variantId: 'variant-new-128',
        condition: 'new',
        storage: '128GB',
      },
    ]);
  });

  it('uses exact variant feed images before product-level images', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-blue-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { color: 'Blue', storage: '128GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      {
        'prod-1': [
          manifestEntry({
            verified_url: 'https://cdn.example.com/product-main.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-blue-128',
            verified_url: 'https://cdn.example.com/blue-front.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-blue-128',
            is_primary: false,
            position: 1,
            verified_url: 'https://cdn.example.com/blue-back.jpg',
          }),
        ],
      }
    );
    const itemXml = extractItemXml(xml, 'variant-blue-128');

    expect(itemXml).toContain(
      '<g:image_link>https://cdn.example.com/blue-front.jpg</g:image_link>'
    );
    expect(itemXml).toContain(
      '<g:additional_image_link>https://cdn.example.com/blue-back.jpg</g:additional_image_link>'
    );
    expect(itemXml).not.toContain('product-main.jpg');
  });

  it('shares a representative color image set across same-color matrix variants', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-silver-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { color: 'Silver', storage: '128GB' },
            },
            {
              id: 'variant-silver-256',
              condition: 'used',
              price_override: 600000,
              stock_quantity: 2,
              attributes: { color: 'Silver', storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      {
        'prod-1': [
          manifestEntry({
            verified_url: 'https://cdn.example.com/product-main.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-silver-128',
            verified_url: 'https://cdn.example.com/silver-front.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-silver-128',
            is_primary: false,
            position: 1,
            verified_url: 'https://cdn.example.com/silver-left.jpg',
          }),
        ],
      }
    );
    const representativeItem = extractItemXml(xml, 'variant-silver-128');
    const sharedColorItem = extractItemXml(xml, 'variant-silver-256');

    for (const itemXml of [representativeItem, sharedColorItem]) {
      expect(itemXml).toContain(
        '<g:image_link>https://cdn.example.com/silver-front.jpg</g:image_link>'
      );
      expect(itemXml).toContain(
        '<g:additional_image_link>https://cdn.example.com/silver-left.jpg</g:additional_image_link>'
      );
      expect(itemXml).not.toContain('product-main.jpg');
    }
  });

  it('keeps exact image sets for same-color matrix variants that both have images', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-silver-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { color: 'Silver', storage: '128GB' },
            },
            {
              id: 'variant-silver-256',
              condition: 'used',
              price_override: 600000,
              stock_quantity: 2,
              attributes: { color: 'Silver', storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      {
        'prod-1': [
          manifestEntry({
            verified_url: 'https://cdn.example.com/product-main.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-silver-128',
            verified_url: 'https://cdn.example.com/silver-128-front.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-silver-128',
            is_primary: false,
            position: 1,
            verified_url: 'https://cdn.example.com/silver-128-left.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-silver-256',
            verified_url: 'https://cdn.example.com/silver-256-front.jpg',
          }),
          manifestEntry({
            variant_id: 'variant-silver-256',
            is_primary: false,
            position: 1,
            verified_url: 'https://cdn.example.com/silver-256-right.jpg',
          }),
        ],
      }
    );
    const silver128Item = extractItemXml(xml, 'variant-silver-128');
    const silver256Item = extractItemXml(xml, 'variant-silver-256');

    expect(silver128Item).toContain(
      '<g:image_link>https://cdn.example.com/silver-128-front.jpg</g:image_link>'
    );
    expect(silver128Item).toContain(
      '<g:additional_image_link>https://cdn.example.com/silver-128-left.jpg</g:additional_image_link>'
    );
    expect(silver128Item).not.toContain('silver-256');
    expect(silver128Item).not.toContain('product-main.jpg');

    expect(silver256Item).toContain(
      '<g:image_link>https://cdn.example.com/silver-256-front.jpg</g:image_link>'
    );
    expect(silver256Item).toContain(
      '<g:additional_image_link>https://cdn.example.com/silver-256-right.jpg</g:additional_image_link>'
    );
    expect(silver256Item).not.toContain('silver-128');
    expect(silver256Item).not.toContain('product-main.jpg');
  });

  it('does not substitute an unscoped image for a colour variant', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-green-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { color: 'Green', storage: '128GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );
    const itemXml = extractItemXml(xml, 'variant-green-128');

    expect(itemXml).toBe('');
  });

  it('emits sale pricing for conditioned variants when compare_at_price is present', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          compare_at_price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-open-box-sale',
              compare_at_price: 700000,
              condition: 'open_box',
              price_override: 640000,
              stock_quantity: 1,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:price>700000.00 NGN</g:price>');
    expect(xml).toContain('<g:sale_price>640000.00 NGN</g:sale_price>');
  });

  it('normalizes open_box feed conditions to refurbished for GMC output', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-open-box',
              condition: 'open_box',
              price_override: 640000,
              stock_quantity: 1,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:condition>refurbished</g:condition>');
    expect(xml).not.toContain('<g:condition>open_box</g:condition>');
  });

  it('normalizes uk_used feed conditions to used for GMC output', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-uk-used',
              condition: 'uk_used',
              price_override: 610000,
              stock_quantity: 1,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:condition>used</g:condition>');
    expect(xml).not.toContain('<g:condition>uk_used</g:condition>');
  });

  it('skips zero-priced conditioned variants without inventing a purchasable family row', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-zero-priced',
              condition: 'used',
              price_override: 0,
              stock_quantity: 1,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect((xml.match(/<item>/g) || []).length).toBe(0);
    expect(xml).not.toContain('<g:id>prod-1</g:id>');
    expect(xml).not.toContain('<g:id>variant-zero-priced</g:id>');
    expect(xml).not.toContain('<g:price>700000.00 NGN</g:price>');
  });

  it('falls back to one conservative family row when conditioned variants exist but the rollout flag is disabled', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-new-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { storage: '128GB' },
            },
            {
              id: 'variant-used-256',
              condition: 'used',
              price_override: 600000,
              stock_quantity: 2,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: false }),
      BASE_URL,
      defaultManifest
    );

    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(1);
    expect(xml).toContain('<g:id>prod-1</g:id>');
    expect(xml).toContain('<g:price>600000.00 NGN</g:price>');
    expect(xml).toContain('<g:condition>used</g:condition>');
    expect(xml).not.toContain('<g:id>variant-new-128</g:id>');
    expect(xml).not.toContain('<g:item_group_id>');
  });

  it('does not apply the sku_matrix fallback to legacy offer-driven products', () => {
    const xml = generateGoogleMerchantFeed(
      [
        // Edge/migration state: both offers and variants exist, but legacy
        // offer-driven emission must still win when variant_model is legacy
        // and gmc_variants_enabled is disabled.
        product({
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-used',
              condition: 'used',
              price: 610000,
              stock_quantity: 2,
            },
          ],
          variant_model: 'legacy',
          variants: [
            {
              id: 'variant-used-256',
              condition: 'used',
              price_override: 610000,
              stock_quantity: 2,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: false }),
      BASE_URL,
      defaultManifest
    );

    expect((xml.match(/<item>/g) || []).length).toBe(2);
    expect(xml).toContain('<g:id>prod-1</g:id>');
    expect(xml).toContain('<g:id>offer-used</g:id>');
  });
});

describe('generateGoogleMerchantFeed — currency resolution', () => {
  const currencyTestManifest: Record<string, FeedImageManifestEntry[]> = {
    'prod-1': [manifestEntry()],
  };

  it('emits the merchant payout currency (not a hardcoded USD default)', () => {
    const xml = generateGoogleMerchantFeed(
      [product({ price: 45 })],
      merchant({ payout_currency: 'GHS', country: 'GH' }),
      BASE_URL,
      currencyTestManifest
    );

    expect(xml).toContain('<g:price>45.00 GHS</g:price>');
    expect(xml).not.toContain('USD');
  });

  it('falls back to the platform default (NGN) when payout currency is missing', () => {
    const xml = generateGoogleMerchantFeed(
      [product({ price: 45 })],
      merchant({ payout_currency: undefined, country: undefined }),
      BASE_URL,
      currencyTestManifest
    );

    expect(xml).toContain('<g:price>45.00 NGN</g:price>');
  });
});
