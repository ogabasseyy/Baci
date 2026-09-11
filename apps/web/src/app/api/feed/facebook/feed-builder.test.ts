import { describe, expect, it } from 'vitest';
import type {
  FeedMerchant,
  FeedProduct,
} from '../google-merchant/feed-builder';
import { generateFacebookCatalogFeed } from './feed-builder';

const merchant: FeedMerchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  country: 'NG',
  payout_currency: 'NGN',
  slug: 'ogabassey',
};

const baseProduct: FeedProduct = {
  id: 'product-1',
  name: 'Samsung Galaxy S26 Ultra',
  description: '<p>Flagship phone & charger bundle.</p>',
  slug: 'samsung-galaxy-s26-ultra',
  price: 1_200_000,
  compare_at_price: 1_350_000,
  brand: 'Samsung',
  gtin: '1234567890123',
  mpn: 'SM-S26U',
  stock: 4,
  stock_quantity: 4,
  manage_stock: true,
  condition: 'new',
  google_product_category: 'Electronics > Communications > Telephony',
  category: 'Smartphones',
  category_slug: 'smartphones',
};

const imageManifest = {
  'product-1': [
    {
      verified_url: 'https://cdn.example.com/product-1.jpg',
      verified_format: 'jpeg',
      status: 'verified' as const,
      is_primary: true,
      position: 0,
    },
    {
      verified_url: 'https://cdn.example.com/product-1-side.jpg',
      verified_format: 'jpeg',
      status: 'verified' as const,
      is_primary: false,
      position: 1,
    },
  ],
};

describe('generateFacebookCatalogFeed', () => {
  it('emits RSS without items when the product list is empty', () => {
    const xml = generateFacebookCatalogFeed(
      [],
      merchant,
      'https://ogabassey.com',
      {}
    );

    expect(xml).toContain('<rss version="2.0"');
    expect(xml).not.toContain('<item>');
  });

  it('emits Meta catalog XML from the Merchant Center feed data shape', () => {
    const xml = generateFacebookCatalogFeed(
      [baseProduct],
      merchant,
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<g:id>product-1</g:id>');
    expect(xml).toContain('<g:item_group_id>product-1</g:item_group_id>');
    expect(xml).toContain('<g:title>Samsung Galaxy S26 Ultra</g:title>');
    expect(xml).toContain(
      '<g:description>Flagship phone &amp; charger bundle.</g:description>'
    );
    expect(xml).toContain('<g:availability>in stock</g:availability>');
    expect(xml).toContain('<g:sale_price>1200000.00 NGN</g:sale_price>');
    expect(xml).toContain('<g:price>1350000.00 NGN</g:price>');
    expect(xml).toContain(
      '<g:link>https://ogabassey.com/smartphones/samsung-galaxy-s26-ultra</g:link>'
    );
    expect(xml).toContain(
      '<g:image_link>https://cdn.example.com/product-1.jpg</g:image_link>'
    );
    expect(xml).toContain(
      '<g:additional_image_link>https://cdn.example.com/product-1-side.jpg</g:additional_image_link>'
    );
    expect(xml).toContain('<g:brand>Samsung</g:brand>');
    expect(xml).toContain('<g:condition>new</g:condition>');
    expect(xml).toContain('<g:product_type>Smartphones</g:product_type>');
    expect(xml).not.toContain('<image_link></image_link>');
  });

  it('skips products without verified primary images', () => {
    const xml = generateFacebookCatalogFeed(
      [baseProduct],
      merchant,
      'https://ogabassey.com',
      {}
    );

    expect(xml).not.toContain('<item>');
    expect(xml).not.toContain('<g:id>product-1</g:id>');
  });

  it('exports the SKU id and retains the parent as its group id', () => {
    const product: FeedProduct = {
      ...baseProduct,
      id: 'sku-product',
      compare_at_price: undefined,
      price: 0,
      stock: 0,
      stock_quantity: 0,
      variant_model: 'sku_matrix',
      variants: [
        {
          id: 'variant-used-256',
          attributes: { storage: '256GB' },
          condition: 'used',
          price_override: 850_000,
          stock_quantity: 2,
        },
      ],
    };

    const xml = generateFacebookCatalogFeed(
      [product],
      merchant,
      'https://ogabassey.com',
      {
        'sku-product': imageManifest['product-1'],
      }
    );

    expect(xml).toContain('<g:item_group_id>sku-product</g:item_group_id>');
    expect(xml).toContain('<g:id>variant-used-256</g:id>');
    expect(xml).toContain('<g:availability>in stock</g:availability>');
    expect(xml).toContain('<g:price>850000.00 NGN</g:price>');
    expect(xml).toContain('<g:condition>used</g:condition>');
  });

  it('skips zero-priced sku-matrix products when priced variants are missing fallback fields', () => {
    const product: FeedProduct = {
      ...baseProduct,
      id: 'sku-product',
      compare_at_price: undefined,
      price: 0,
      stock: 0,
      stock_quantity: 0,
      variant_model: 'sku_matrix',
      variants: [
        {
          id: 'variant-missing-condition',
          attributes: { storage: '256GB' },
          price_override: 850_000,
          stock_quantity: 2,
        },
      ],
    };

    const xml = generateFacebookCatalogFeed(
      [product],
      merchant,
      'https://ogabassey.com',
      {
        'sku-product': imageManifest['product-1'],
      }
    );

    expect(xml).not.toContain('<item>');
    expect(xml).not.toContain('<g:id>sku-product</g:id>');
    expect(xml).not.toContain('<g:price>0.00 NGN</g:price>');
  });

  it('skips zero-priced sku-matrix products when priced variants have blank ids', () => {
    const product: FeedProduct = {
      ...baseProduct,
      id: 'sku-product',
      compare_at_price: undefined,
      price: 0,
      stock: 0,
      stock_quantity: 0,
      variant_model: 'sku_matrix',
      variants: [
        {
          id: '',
          attributes: { storage: '256GB' },
          condition: 'used',
          price_override: 850_000,
          stock_quantity: 2,
        },
      ],
    };

    const xml = generateFacebookCatalogFeed(
      [product],
      merchant,
      'https://ogabassey.com',
      {
        'sku-product': imageManifest['product-1'],
      }
    );

    expect(xml).not.toContain('<item>');
    expect(xml).not.toContain('<g:id>sku-product</g:id>');
    expect(xml).not.toContain('<g:price>0.00 NGN</g:price>');
  });

  it('uses the merchant brand fallback and Facebook availability vocabulary', () => {
    const xml = generateFacebookCatalogFeed(
      [
        {
          ...baseProduct,
          brand: undefined,
          compare_at_price: undefined,
          stock: 0,
          stock_quantity: 0,
        },
      ],
      merchant,
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).toContain('<g:brand>Ogabassey</g:brand>');
    expect(xml).toContain('<g:availability>out of stock</g:availability>');
    expect(xml).not.toContain('out_of_stock');
  });

  it('truncates overlong product titles to the Facebook title limit', () => {
    const longTitle = 'A'.repeat(151);

    const xml = generateFacebookCatalogFeed(
      [{ ...baseProduct, name: longTitle }],
      merchant,
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).toContain(`<g:title>${'A'.repeat(147)}...</g:title>`);
  });

  it('treats unmanaged zero stock as in stock', () => {
    const xml = generateFacebookCatalogFeed(
      [
        {
          ...baseProduct,
          manage_stock: false,
          stock: 0,
          stock_quantity: 0,
        },
      ],
      merchant,
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).toContain('<g:availability>in stock</g:availability>');
  });

  it('emits refurbished as a valid Facebook condition', () => {
    const xml = generateFacebookCatalogFeed(
      [{ ...baseProduct, condition: 'refurbished' }],
      merchant,
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).toContain('<g:condition>refurbished</g:condition>');
  });

  it('skips products when the generated storefront URL is invalid', () => {
    const xml = generateFacebookCatalogFeed(
      [baseProduct],
      merchant,
      'not-a-url',
      imageManifest
    );

    expect(xml).not.toContain('<g:id>product-1</g:id>');
    expect(xml).not.toContain('<item>');
  });

  it('emits the merchant payout currency (not a hardcoded USD default)', () => {
    const xml = generateFacebookCatalogFeed(
      [baseProduct],
      { ...merchant, payout_currency: 'GHS', country: 'GH' },
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).toContain('<g:sale_price>1200000.00 GHS</g:sale_price>');
    expect(xml).not.toContain('USD');
  });

  it('falls back to the platform default (NGN) when payout currency is missing', () => {
    const xml = generateFacebookCatalogFeed(
      [baseProduct],
      { ...merchant, payout_currency: undefined, country: undefined },
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).toContain('<g:sale_price>1200000.00 NGN</g:sale_price>');
  });
});
