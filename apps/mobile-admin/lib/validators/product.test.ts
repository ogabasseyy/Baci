import { describe, expect, it } from 'vitest';
import { ProductDbSchema } from '@/lib/validators/product';

describe('ProductDbSchema', () => {
  it('allows variant products to omit a parent SKU while preserving variant SKUs', () => {
    const parsed = ProductDbSchema.parse({
      name: 'Xiaomi Redmi A7',
      price: 137900,
      cost_price: 0,
      stock_quantity: 0,
      category_id: '',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [{ key: 'ram', value: '3GB' }],
          condition: 'new',
          price: 137900,
          sku: 'XM-AZ-3-64-BLUE',
          stock_quantity: 3,
        },
      ],
    });

    expect(parsed.sku).toBeNull();
    expect(parsed.variants[0]?.sku).toBe('XM-AZ-3-64-BLUE');
  });

  it('rejects a blank SKU for non-variant products', () => {
    expect(() =>
      ProductDbSchema.parse({
        name: 'Non-variant product',
        sku: '   ',
        price: 100,
        stock_quantity: 0,
        category_id: '',
        manage_stock: true,
        status: 'active',
        images: [],
        variant_attributes: [],
      })
    ).toThrow('SKU is required');
  });

  it('keeps stock and stock_quantity in sync for inserts and updates', () => {
    const parsed = ProductDbSchema.parse({
      brand: 'Apple',
      name: 'Phone',
      sku: 'SKU-123',
      price: 1000,
      cost_price: 500,
      stock_quantity: 8,
      low_stock_threshold: 3,
      description: 'A phone',
      category_id: '',
      color: 'Black',
      manage_stock: true,
      status: 'active',
      images: [],
      variant_attributes: [],
      fulfillment_details: { items: [] },
    });

    expect(parsed.stock_quantity).toBe(8);
    expect(parsed.stock).toBe(8);
    expect(parsed.brand).toBe('Apple');
    expect(parsed.category_id).toBeNull();
  });

  it('keeps explicit stock values when stock management is disabled', () => {
    const parsed = ProductDbSchema.parse({
      name: 'Digital Product',
      sku: 'DIGI-001',
      price: 2500,
      cost_price: 0,
      stock_quantity: 12,
      description: 'Delivered instantly',
      category_id: '',
      manage_stock: false,
      status: 'active',
      images: [],
      variant_attributes: [],
      fulfillment_details: { items: [] },
    });

    expect(parsed.manage_stock).toBe(false);
    expect(parsed.stock_quantity).toBe(12);
    expect(parsed.stock).toBe(12);
    expect(parsed.category_id).toBeNull();
  });

  it('accepts zero stock quantities and keeps the mirrored stock field aligned', () => {
    const parsed = ProductDbSchema.parse({
      name: 'Empty Shelf',
      sku: 'EMPTY-001',
      price: 100,
      stock_quantity: 0,
      category_id: '',
      manage_stock: true,
      status: 'draft',
      images: [],
      variant_attributes: [],
    });

    expect(parsed.stock_quantity).toBe(0);
    expect(parsed.stock).toBe(0);
    expect(parsed.category_id).toBeNull();
  });

  it('sanitizes and preserves the brand field for product writes', () => {
    const parsed = ProductDbSchema.parse({
      brand: '  <b>Apple</b>  ',
      name: 'Apple Watch',
      sku: 'WATCH-001',
      price: 100,
      stock_quantity: 2,
      category_id: '',
      manage_stock: true,
      status: 'active',
      images: [],
      variant_attributes: [],
    });

    expect(parsed.brand).toBe('Apple');
  });

  it('rejects missing stock_quantity values', () => {
    expect(() =>
      ProductDbSchema.parse({
        name: 'Missing Stock',
        sku: 'MISS-001',
        price: 100,
        category_id: '',
        manage_stock: true,
        status: 'active',
        images: [],
        variant_attributes: [],
      })
    ).toThrow();
  });

  it('rejects negative stock quantities', () => {
    expect(() =>
      ProductDbSchema.parse({
        name: 'Negative Stock',
        sku: 'NEG-001',
        price: 100,
        stock_quantity: -1,
        category_id: '',
        manage_stock: true,
        status: 'active',
        images: [],
        variant_attributes: [],
      })
    ).toThrow();
  });

  it('derives parent inventory and variant summaries for structured variants', () => {
    const parsed = ProductDbSchema.parse({
      name: 'iPhone 14 Pro',
      sku: 'IP14PRO',
      price: 0,
      cost_price: 500000,
      stock_quantity: 0,
      description: 'A phone',
      category_id: '',
      manage_stock: false,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [
            { key: 'storage', value: '128GB' },
            { key: 'color', value: 'Black' },
          ],
          cost_price: 700000,
          price: 900000,
          sku: 'IP14PRO-128-BLK',
          stock_quantity: 2,
        },
        {
          attributes: [
            { key: 'storage', value: '256GB' },
            { key: 'color', value: 'Silver' },
          ],
          cost_price: 750000,
          price: 950000,
          sku: 'IP14PRO-256-SLV',
          stock_quantity: 4,
        },
      ],
    });

    expect(parsed.price).toBe(900000);
    expect(parsed.stock_quantity).toBe(6);
    expect(parsed.stock).toBe(6);
    expect(parsed.manage_stock).toBe(false);
    expect(parsed.color).toBeNull();
    expect(parsed.variant_attributes).toEqual({
      color: ['Black', 'Silver'],
      storage: ['128GB', '256GB'],
    });
    expect(parsed.variants).toEqual([
      {
        attributes: { color: 'Black', storage: '128GB' },
        condition: null,
        cost_price: 700000,
        id: undefined,
        images: [],
        primary_image: null,
        price_override: 900000,
        sku: 'IP14PRO-128-BLK',
        stock_quantity: 2,
      },
      {
        attributes: { color: 'Silver', storage: '256GB' },
        condition: null,
        cost_price: 750000,
        id: undefined,
        images: [],
        primary_image: null,
        price_override: 950000,
        sku: 'IP14PRO-256-SLV',
        stock_quantity: 4,
      },
    ]);
  });

  it('rejects variant products without variants', () => {
    expect(() =>
      ProductDbSchema.parse({
        name: 'Variant Parent',
        sku: 'VAR-001',
        price: 0,
        stock_quantity: 0,
        category_id: '',
        manage_stock: true,
        status: 'active',
        images: [],
        has_variants: true,
        variant_attributes: [],
        variants: [],
      })
    ).toThrow('Add at least one variant before saving.');
  });

  it('rejects duplicate variant attribute combinations', () => {
    expect(() =>
      ProductDbSchema.parse({
        name: 'Duplicate Variant Parent',
        sku: 'VAR-002',
        price: 0,
        stock_quantity: 0,
        category_id: '',
        manage_stock: true,
        status: 'active',
        images: [],
        has_variants: true,
        variant_attributes: [],
        variants: [
          {
            attributes: [{ key: 'storage', value: '128GB' }],
            price: 500,
            stock_quantity: 1,
          },
          {
            attributes: [{ key: 'storage', value: '128GB' }],
            price: 600,
            stock_quantity: 1,
          },
        ],
      })
    ).toThrow('Duplicate variants must be merged or changed.');
  });

  it('allows duplicate attributes across different conditions for sku_matrix variants', () => {
    const parsed = ProductDbSchema.parse({
      name: 'iPad 11th Gen',
      sku: 'IPAD11',
      price: 0,
      stock_quantity: 0,
      category_id: '',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [
            { key: 'storage', value: '128GB' },
            { key: 'connectivity', value: 'WiFi' },
          ],
          condition: 'new',
          price: 550000,
          stock_quantity: 3,
        },
        {
          attributes: [
            { key: 'storage', value: '128GB' },
            { key: 'connectivity', value: 'WiFi' },
          ],
          condition: 'used',
          price: 500000,
          stock_quantity: 1,
        },
      ],
    });

    expect(parsed.variant_model).toBe('sku_matrix');
    expect(parsed.migration_status).toBe('migrated');
    // The default-variant selector mirrors the SQL projection:
    // condition rank first (used < open_box < new), then price.
    expect(parsed.condition).toBe('used');
    expect(parsed.price).toBe(500000);
    expect(parsed.stock_quantity).toBe(1);
    expect(parsed.variants).toEqual([
      expect.objectContaining({
        attributes: { connectivity: 'WiFi', storage: '128GB' },
        condition: 'new',
      }),
      expect.objectContaining({
        attributes: { connectivity: 'WiFi', storage: '128GB' },
        condition: 'used',
      }),
    ]);
  });

  it('uses the first variant media color for the parent projection', () => {
    const parsed = ProductDbSchema.parse({
      name: 'iPhone 15 Pro',
      sku: 'IP15PRO',
      price: 0,
      stock_quantity: 0,
      category_id: '',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [
            { key: 'storage', value: '128GB' },
            { key: 'color', value: 'Natural Titanium' },
          ],
          condition: 'new',
          price: 900000,
          primary_image: 'https://cdn.example.com/natural.jpg',
          stock_quantity: 2,
        },
        {
          attributes: [
            { key: 'storage', value: '128GB' },
            { key: 'color', value: 'Black' },
          ],
          condition: 'used',
          price: 800000,
          primary_image: 'https://cdn.example.com/black.jpg',
          stock_quantity: 3,
        },
      ],
    });

    expect(parsed.condition).toBe('used');
    expect(parsed.color).toBe('Natural Titanium');
    expect(parsed.price).toBe(800000);
  });

  it('uses British spelling colour attributes for the parent projection', () => {
    const parsed = ProductDbSchema.parse({
      name: 'iPhone 15 Pro',
      sku: 'IP15PRO',
      price: 0,
      stock_quantity: 0,
      category_id: '',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [
            { key: 'storage', value: '128GB' },
            { key: 'colour', value: 'Black' },
          ],
          condition: 'used',
          price: 800000,
          primary_image: 'https://cdn.example.com/black.jpg',
          stock_quantity: 3,
        },
        {
          attributes: [
            { key: 'storage', value: '128GB' },
            { key: 'Colour', value: 'Natural Titanium' },
          ],
          condition: 'new',
          price: 900000,
          primary_image: 'https://cdn.example.com/natural.jpg',
          stock_quantity: 2,
        },
      ],
    });

    expect(parsed.condition).toBe('used');
    expect(parsed.color).toBe('Black');
    expect(parsed.price).toBe(800000);
  });

  it('preserves the parent color when variants do not define color attributes', () => {
    const parsed = ProductDbSchema.parse({
      name: 'iPad Air',
      sku: 'IPAD-AIR',
      price: 0,
      stock_quantity: 0,
      category_id: '',
      color: 'Blue',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [{ key: 'storage', value: '128GB' }],
          condition: 'used',
          price: 500000,
          stock_quantity: 2,
        },
        {
          attributes: [{ key: 'storage', value: '256GB' }],
          condition: 'new',
          price: 650000,
          stock_quantity: 2,
        },
      ],
    });

    expect(parsed.color).toBe('Blue');
    expect(parsed.variant_model).toBe('sku_matrix');
  });

  it('rejects sku_matrix variants when one row is missing condition', () => {
    expect(() =>
      ProductDbSchema.parse({
        name: 'Apple Watch Series 11',
        sku: 'AWS11',
        price: 0,
        stock_quantity: 0,
        category_id: '',
        manage_stock: true,
        status: 'active',
        images: [],
        has_variants: true,
        variant_attributes: [],
        variants: [
          {
            attributes: [{ key: 'size', value: '41mm' }],
            condition: 'new',
            price: 400000,
            stock_quantity: 2,
          },
          {
            attributes: [{ key: 'size', value: '45mm' }],
            price: 450000,
            stock_quantity: 1,
          },
        ],
      })
    ).toThrow('Every sku_matrix variant must include a condition.');
  });

  it('canonicalizes condition-only sku_matrix variants without extra attributes', () => {
    const parsed = ProductDbSchema.parse({
      name: 'MacBook Air M2',
      sku: 'MBA-M2',
      price: 0,
      stock_quantity: 0,
      category_id: '',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [],
          condition: 'refurbished',
          price: 900000,
          stock_quantity: 2,
        },
      ],
    });

    expect(parsed.variant_model).toBe('sku_matrix');
    expect(parsed.condition).toBe('open_box');
    expect(parsed.variants[0]).toEqual(
      expect.objectContaining({
        attributes: {},
        condition: 'open_box',
        price_override: 900000,
      })
    );
  });

  it('rejects unsupported variant conditions at the schema boundary', () => {
    expect(() =>
      ProductDbSchema.parse({
        name: 'Galaxy S24',
        sku: 'GAL-S24',
        price: 0,
        stock_quantity: 0,
        category_id: '',
        manage_stock: true,
        status: 'active',
        images: [],
        has_variants: true,
        variant_attributes: [],
        variants: [
          {
            attributes: [],
            condition: 'scratch_and_dent',
            price: 350000,
            stock_quantity: 1,
          },
        ],
      })
    ).toThrow();
  });

  it('preserves legacy condition and omits migration_status outside sku_matrix', () => {
    const parsed = ProductDbSchema.parse({
      name: 'Legacy Used Phone',
      sku: 'LEG-USED',
      price: 200000,
      stock_quantity: 4,
      category_id: '',
      condition: 'used',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: false,
      variant_attributes: [],
      variants: [],
    });

    expect(parsed.variant_model).toBe('legacy');
    expect(parsed.condition).toBe('used');
    expect(parsed).not.toHaveProperty('migration_status');
  });

  it('keeps products legacy when variants are disabled even if stale rows still carry conditions', () => {
    const parsed = ProductDbSchema.parse({
      name: 'Legacy Phone',
      sku: 'LEG-STILL',
      price: 250000,
      stock_quantity: 4,
      category_id: '',
      condition: 'used',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: false,
      variant_attributes: [],
      variants: [
        {
          attributes: [{ key: 'storage', value: '128GB' }],
          condition: 'new',
          price: 300000,
          stock_quantity: 2,
        },
      ],
    });

    expect(parsed.variant_model).toBe('legacy');
    expect(parsed.condition).toBe('used');
    expect(parsed.variants).toEqual([]);
    expect(parsed).not.toHaveProperty('migration_status');
  });

  it('preserves zero cost prices and omits ids for unsaved variants', () => {
    const parsed = ProductDbSchema.parse({
      name: 'Galaxy S25',
      sku: 'GAL-S25',
      price: 500000,
      cost_price: 0,
      stock_quantity: 2,
      category_id: '',
      manage_stock: true,
      status: 'active',
      images: [],
      has_variants: true,
      variant_attributes: [],
      variants: [
        {
          attributes: [{ key: 'storage', value: '128GB' }],
          condition: 'used',
          cost_price: 0,
          price: 450000,
          sku: 'GAL-S25-USED-128',
          stock_quantity: 2,
        },
      ],
    });

    expect(parsed.variants[0]?.cost_price).toBe(0);
    expect(parsed.variants[0]?.id).toBeUndefined();
  });
});
