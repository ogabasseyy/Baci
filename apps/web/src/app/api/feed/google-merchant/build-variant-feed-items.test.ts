import { describe, expect, it } from 'vitest';
import { buildVariantFeedItems } from './build-variant-feed-items';
import type { FeedProduct } from './feed-builder';

const product: FeedProduct = {
  id: 'phone',
  name: 'Phone',
  description: 'A phone',
  price: 10,
  stock: 0,
  manage_stock: false,
  variants: [
    {
      id: 'white-new',
      condition: 'new',
      attributes: { color: 'White' },
      price_override: 20,
    },
    {
      id: 'white-used',
      condition: 'used',
      attributes: { color: 'White' },
      price_override: 10,
    },
    {
      id: 'blue-new',
      condition: 'new',
      attributes: { color: 'Blue' },
      price_override: 25,
    },
  ],
};
const input = {
  product,
  variants: product.variants || [],
  productUrl: 'https://example.com/phone',
  currency: 'NGN',
  brand: 'Brand',
  platform: 'facebook' as const,
  manifest: [
    {
      variant_id: 'white-new',
      verified_url: 'https://cdn.example.com/white.jpg',
      verified_format: 'jpeg',
      status: 'verified' as const,
      is_primary: true,
      position: 0,
    },
  ],
};
describe('buildVariantFeedItems', () => {
  it.each([
    'Color',
    'colour',
    'Colour',
  ])('matches %s to a same-colour sibling instead of a family image', (key) => {
    const xml = buildVariantFeedItems({
      ...input,
      variants: [
        { id: 'alias', condition: 'new', attributes: { [key]: 'White' } },
      ],
    });
    expect(xml).toContain('<g:id>alias</g:id>');
    expect(xml).toContain('white.jpg');
    expect(
      buildVariantFeedItems({
        ...input,
        variants: [
          { id: 'alias', condition: 'new', attributes: { [key]: 'Blue' } },
        ],
        manifest: input.manifest.map((entry) => ({
          ...entry,
          variant_id: null,
        })),
      })
    ).toBe('');
  });
  it.each([
    'open_box',
    'refurbished',
  ] as const)('preserves %s in the landing URL', (condition) => {
    const xml = buildVariantFeedItems({
      ...input,
      variants: [{ ...input.variants[0], condition }],
    });
    expect(xml).toContain(`condition=${condition}`);
    expect(xml).toContain('<g:condition>refurbished</g:condition>');
  });
  it('does not substitute a generic image for a color_hex variant', () => {
    expect(
      buildVariantFeedItems({
        ...input,
        variants: [
          { id: 'hex', condition: 'new', attributes: { color_hex: '#fff' } },
        ],
        manifest: input.manifest.map((entry) => ({
          ...entry,
          variant_id: null,
        })),
      })
    ).toBe('');
  });
  it('exports new and used separately with the matching colour image, price and deep link', () => {
    const xml = buildVariantFeedItems(input);
    expect(xml).toContain('<g:id>white-used</g:id>');
    expect(xml).toContain('<g:id>white-new</g:id>');
    expect(xml).toContain('variantId=white-used');
    expect(xml).toContain('<g:price>20.00 NGN</g:price>');
    expect(xml).toContain('<g:price>10.00 NGN</g:price>');
    expect(xml).toContain('<g:availability>in stock</g:availability>');
    expect(xml).not.toContain('<g:id>blue-new</g:id>');
  });
  it('rejects nonfinite prices and unknown conditions', () => {
    expect(
      buildVariantFeedItems({
        ...input,
        variants: [
          {
            ...product.variants?.[0],
            id: 'white-new',
            price_override: Number.NaN,
          },
        ],
      })
    ).toBe('');
    expect(
      buildVariantFeedItems({
        ...input,
        variants: [
          { ...product.variants?.[0], id: 'white-new', condition: null },
        ],
      })
    ).toBe('');
  });
  it('uses SKU identifiers and discounts without inheriting parent values', () => {
    const xml = buildVariantFeedItems({
      ...input,
      variants: [
        {
          ...product.variants?.[0],
          id: 'white-new',
          compare_at_price: 30,
          attributes: { color: 'White', gtin: '1234567890123', mpn: 'sku-mpn' },
        },
      ],
    });
    expect(xml).toContain('<g:gtin>1234567890123</g:gtin>');
    expect(xml).toContain('<g:mpn>sku-mpn</g:mpn>');
    expect(xml).not.toContain('gtin=');
    expect(xml).not.toContain('mpn=');
    expect(xml).toContain('<g:sale_price>20.00 NGN</g:sale_price>');
  });
});
