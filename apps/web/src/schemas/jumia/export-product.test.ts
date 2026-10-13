import { describe, expect, it } from 'vitest';
import { jumiaExportProductSchema } from './export-product';

const integrationId = '00000000-0000-4000-8000-000000000099';
const productId = '00000000-0000-4000-8000-000000000002';

describe('jumiaExportProductSchema', () => {
  it('parses a valid export payload including productId', () => {
    expect(
      jumiaExportProductSchema.parse({
        integrationId,
        productId,
        name: ' Product ',
        brand: { code: 1, name: 'Brand' },
        category: { code: 42 },
        description: 'Description',
        images: [{ url: 'https://cdn.example.com/product.jpg', primary: true }],
        variations: [{ sellerSku: 'SKU-1', price: 5000 }],
      })
    ).toEqual({
      integrationId,
      productId,
      name: 'Product',
      brand: { code: 1, name: 'Brand' },
      category: { code: 42 },
      description: 'Description',
      images: [{ url: 'https://cdn.example.com/product.jpg', primary: true }],
      variations: [{ sellerSku: 'SKU-1', price: 5000, currency: 'NGN' }],
    });
  });

  it('accepts the minimal payload and omits optional fields', () => {
    expect(
      jumiaExportProductSchema.parse({
        integrationId,
        productId,
        name: 'Product',
        brand: { code: 1, name: 'Brand' },
        category: { code: 42 },
        variations: [{ sellerSku: 'SKU-1', price: 1 }],
      })
    ).toEqual({
      integrationId,
      productId,
      name: 'Product',
      brand: { code: 1, name: 'Brand' },
      category: { code: 42 },
      variations: [{ sellerSku: 'SKU-1', price: 1, currency: 'NGN' }],
    });
  });

  it.each([
    { integrationId: 'bad', productId, name: 'Product' },
    { integrationId, productId: 'bad', name: 'Product' },
    { integrationId, productId, name: '' },
    { integrationId, productId, name: 'Product', variations: [] },
    {
      integrationId,
      productId,
      name: 'Product',
      variations: [{ sellerSku: 'SKU-1', price: 1 }],
      images: [{ url: 'not-a-url' }],
    },
  ])('rejects invalid export payloads', (input) => {
    expect(jumiaExportProductSchema.safeParse(input).success).toBe(false);
  });
});
