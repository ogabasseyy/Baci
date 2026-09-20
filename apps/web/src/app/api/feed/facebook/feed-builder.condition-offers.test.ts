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

describe('generateFacebookCatalogFeed condition offers', () => {
  it('emits the canonical storefront condition in offer links', () => {
    const xml = generateFacebookCatalogFeed(
      [
        {
          ...baseProduct,
          offers: [
            {
              id: 'offer-refurb',
              condition: 'refurbished',
              price: 1_000_000,
              stock_quantity: 2,
            },
          ],
        },
      ],
      merchant,
      'https://ogabassey.com',
      imageManifest
    );
    expect(xml).toContain('offer-refurb');
    expect(xml).toContain('condition=open_box');
    expect(xml).not.toContain('condition=refurbished');
  });
  it('excludes offers that duplicate the parent condition', () => {
    const xml = generateFacebookCatalogFeed(
      [
        {
          ...baseProduct,
          offers: [
            {
              id: 'offer-same',
              condition: 'new',
              price: 1_100_000,
              stock_quantity: 2,
            },
          ],
        },
      ],
      merchant,
      'https://ogabassey.com',
      imageManifest
    );

    expect(xml).not.toContain('offer-same');
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(1);
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
});
