import { describe, expect, it } from 'vitest';
import {
  MAX_PRODUCT_PAGES,
  publishProductSchema,
  publishProductsPageSchema,
} from '@/schemas/jumia/publish-products';

describe('publishProductSchema', () => {
  it('parses a valid product and trims required strings', () => {
    expect(
      publishProductSchema.parse({
        id: ' product-1 ',
        name: ' Sample Product ',
        price: 1999,
        sku: 'SKU-1',
        stock: 5,
        variants: [
          {
            sku: 'SKU-1',
            price_override: 1500,
            stock_quantity: 2,
            is_inventory_anchor: true,
          },
        ],
      })
    ).toEqual({
      id: 'product-1',
      name: 'Sample Product',
      price: 1999,
      sku: 'SKU-1',
      stock: 5,
      variants: [
        {
          sku: 'SKU-1',
          price_override: 1500,
          stock_quantity: 2,
          is_inventory_anchor: true,
        },
      ],
    });
  });

  it('accepts nullable SKUs from the products API', () => {
    expect(
      publishProductSchema.parse({
        id: 'product-1',
        name: 'Sample Product',
        sku: null,
        price: 1999,
      })
    ).toEqual({
      id: 'product-1',
      name: 'Sample Product',
      sku: null,
      price: 1999,
    });
  });

  it('preserves local category and brand metadata for homogeneous batches', () => {
    expect(
      publishProductSchema.parse({
        id: 'product-1',
        name: 'Sample Product',
        price: 1999,
        category: 'Phones',
        brand: 'Acme',
      })
    ).toMatchObject({ category: 'Phones', brand: 'Acme' });
  });

  it('accepts legacy string image entries alongside object image entries', () => {
    expect(
      publishProductSchema.parse({
        id: 'product-1',
        name: 'Sample Product',
        price: 1999,
        images: [
          'https://cdn.example.com/legacy.jpg',
          { url: 'https://cdn.example.com/object.jpg' },
        ],
      }).images
    ).toEqual([
      'https://cdn.example.com/legacy.jpg',
      { url: 'https://cdn.example.com/object.jpg' },
    ]);
  });

  it('accepts variants that inherit the parent price or lack a SKU', () => {
    expect(
      publishProductSchema.parse({
        id: 'product-1',
        name: 'Sample Product',
        sku: null,
        price: 1999,
        variants: [
          {
            sku: null,
            price_override: null,
            stock_quantity: 2,
            is_inventory_anchor: false,
          },
        ],
      }).variants
    ).toEqual([
      {
        sku: null,
        price_override: null,
        stock_quantity: 2,
        is_inventory_anchor: false,
      },
    ]);
  });

  it.each([
    {},
    { id: '', name: 'Product', price: 10 },
    { id: 'product-1', name: '', price: 10 },
    { id: 'product-1', name: 'Product', price: '10' },
  ])('rejects invalid product payloads', (input) => {
    expect(publishProductSchema.safeParse(input).success).toBe(false);
  });
});

describe('publishProductsPageSchema', () => {
  it('parses products and finite positive pagination', () => {
    expect(
      publishProductsPageSchema.parse({
        products: [{ id: 'product-1', name: 'Sample Product', price: 1999 }],
        pagination: { totalPages: 3 },
      })
    ).toEqual({
      products: [{ id: 'product-1', name: 'Sample Product', price: 1999 }],
      pagination: { totalPages: 3 },
    });
  });

  it('defaults products to an empty array when omitted', () => {
    expect(publishProductsPageSchema.parse({})).toEqual({
      products: [],
    });
  });

  it('accepts an empty catalog with zero total pages', () => {
    expect(
      publishProductsPageSchema.parse({
        products: [],
        pagination: { totalPages: 0 },
      })
    ).toEqual({
      products: [],
      pagination: { totalPages: 0 },
    });
  });

  it.each([
    { pagination: { totalPages: -1 } },
    { pagination: { totalPages: Number.NaN } },
    { pagination: { totalPages: Number.POSITIVE_INFINITY } },
  ])('rejects invalid pagination totalPages', (input) => {
    expect(publishProductsPageSchema.safeParse(input).success).toBe(false);
  });
});

describe('MAX_PRODUCT_PAGES', () => {
  it('exports the publish dialog pagination bound', () => {
    expect(MAX_PRODUCT_PAGES).toBe(50);
  });
});
