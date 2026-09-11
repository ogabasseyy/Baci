import { describe, expect, it } from 'vitest';
import { generateFacebookCatalogFeed } from '../facebook/feed-builder';
import { type FeedProduct, generateGoogleMerchantFeed } from './feed-builder';

const product: FeedProduct = {
  id: 'phone',
  name: 'Phone',
  slug: 'phone',
  description: 'Phone',
  price: 891000,
  compare_at_price: 1500000,
  stock: 0,
  manage_stock: false,
  condition: 'used',
  variant_model: 'sku_matrix',
  gtin: 'parent-gtin',
  mpn: 'parent-mpn',
  variants: [
    {
      id: 'used',
      condition: 'used',
      price_override: 891000,
      attributes: { color: 'White', storage: '128GB' },
    },
    {
      id: 'new',
      condition: 'new',
      price_override: 1032000,
      attributes: { color: 'White', storage: '128GB' },
    },
  ],
};
const merchant = { id: 'merchant', slug: 'shop', business_name: 'Shop' };
const images = {
  phone: [
    {
      variant_id: 'used',
      verified_url: 'https://cdn.example.com/white.jpg',
      verified_format: 'jpeg' as const,
      status: 'verified' as const,
      is_primary: true,
      position: 0,
    },
  ],
};

describe('feed variant integrity', () => {
  it.each([
    generateGoogleMerchantFeed,
    generateFacebookCatalogFeed,
  ])('does not label a legacy product with a blank condition as new', (build) => {
    const xml = build(
      [{ ...product, variant_model: 'legacy', condition: undefined }],
      merchant,
      'https://example.com',
      { phone: [{ ...images.phone[0], variant_id: null }] }
    );
    expect(xml).not.toContain('<item>');
  });
  it('does not borrow a parent discount or identifiers for a SKU', () => {
    const xml = generateGoogleMerchantFeed(
      [product],
      merchant,
      'https://example.com',
      images
    );
    expect(xml).toContain('<g:id>new</g:id>');
    expect(xml).not.toContain('<g:sale_price>');
    expect(xml).not.toContain('parent-gtin');
    expect(xml).not.toContain('parent-mpn');
    expect(xml).not.toContain('<g:identifier_exists>no</g:identifier_exists>');
  });

  it('omits an unrecognised condition instead of advertising it as new', () => {
    const xml = generateGoogleMerchantFeed(
      [
        {
          ...product,
          variants: [
            { ...product.variants?.[0], id: 'unknown', condition: null },
          ],
        },
      ],
      merchant,
      'https://example.com',
      {
        phone: [{ ...images.phone[0], variant_id: null }],
      }
    );
    expect(xml).not.toContain('<item>');
  });

  it('keeps the intentional open box to refurbished mapping', () => {
    const xml = generateGoogleMerchantFeed(
      [
        {
          ...product,
          variants: [
            { ...product.variants?.[0], id: 'used', condition: 'open_box' },
          ],
        },
      ],
      merchant,
      'https://example.com',
      images
    );
    expect(xml).toContain('<g:condition>refurbished</g:condition>');
  });
});
