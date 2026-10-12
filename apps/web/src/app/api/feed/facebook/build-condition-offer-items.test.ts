import { describe, expect, it } from 'vitest';
import type {
  FeedMerchant,
  FeedProduct,
} from '../google-merchant/feed-builder';
import { buildConditionOfferItems } from './build-condition-offer-items';

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
  description: 'Flagship phone.',
  slug: 'samsung-galaxy-s26-ultra',
  price: 1_200_000,
  compare_at_price: 1_350_000,
  brand: 'Samsung',
  stock: 4,
  stock_quantity: 4,
  manage_stock: true,
  condition: 'new',
};

const manifestEntries = [
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
];

function build(product: FeedProduct = baseProduct): string {
  return buildConditionOfferItems({
    brandName: merchant.business_name,
    currency: 'NGN',
    manifestEntries,
    product,
    productUrl: 'https://ogabassey.com/products/samsung-galaxy-s26-ultra',
  });
}

describe('buildConditionOfferItems', () => {
  it('renders a single ungrouped base item without offers', () => {
    const xml = build();
    expect(xml).toContain('<g:id>product-1</g:id>');
    expect(xml).toContain('<g:item_group_id>product-1</g:item_group_id>');
    expect(xml).toContain('<g:condition>new</g:condition>');
    expect(xml).toContain(
      '<g:image_link>https://cdn.example.com/product-1.jpg</g:image_link>'
    );
    expect(xml).toContain(
      '<g:additional_image_link>https://cdn.example.com/product-1-side.jpg</g:additional_image_link>'
    );
  });

  it('qualifies the grouped base id and emits offer rows', () => {
    const xml = build({
      ...baseProduct,
      offers: [
        {
          id: 'offer-used',
          condition: 'used',
          price: 1_000_000,
          stock_quantity: 2,
        },
      ],
    });
    expect(xml).toContain('<g:id>product-1-new</g:id>');
    expect(xml).toContain('<g:id>offer-used</g:id>');
    expect(xml).toContain('<g:item_group_id>product-1</g:item_group_id>');
    expect(xml).not.toContain('<g:id>product-1</g:id>');
    expect(xml).toContain('condition=used');
  });

  it('suppresses the base item without a primary image', () => {
    const xml = buildConditionOfferItems({
      brandName: merchant.business_name,
      currency: 'NGN',
      manifestEntries: [],
      product: baseProduct,
      productUrl: 'https://ogabassey.com/products/samsung-galaxy-s26-ultra',
    });
    expect(xml).toBe('');
  });

  it('omits whitespace-only parent GTIN/MPN from base and offer rows', () => {
    const xml = build({
      ...baseProduct,
      gtin: '   ',
      mpn: '\t ',
      offers: [
        {
          id: 'offer-used',
          condition: 'used',
          price: 1_000_000,
          stock_quantity: 2,
        },
      ],
    });
    expect(xml).not.toContain('<g:gtin>');
    expect(xml).not.toContain('<g:mpn>');
  });

  it('trims padded parent GTIN/MPN in base and offer rows', () => {
    const xml = build({
      ...baseProduct,
      gtin: '  0123456789012  ',
      mpn: '  MPN-123  ',
      offers: [
        {
          id: 'offer-used',
          condition: 'used',
          price: 1_000_000,
          stock_quantity: 2,
        },
      ],
    });
    expect(xml).toContain('<g:gtin>0123456789012</g:gtin>');
    expect(xml).toContain('<g:mpn>MPN-123</g:mpn>');
    expect(xml).not.toContain('  0123456789012  ');
  });
});
