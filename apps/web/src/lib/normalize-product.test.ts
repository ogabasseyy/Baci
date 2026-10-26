import { describe, expect, it } from 'vitest';
import { normalizeProduct } from '@/lib/normalize-product';

describe('normalizeProduct', () => {
  const baseRawProduct = {
    id: 'prod-1',
    name: 'Samsung Galaxy S25',
    slug: 'samsung-galaxy-s25',
    description: 'A flagship phone',
    price: 860000,
    compare_at_price: undefined,
    condition: 'new',
    brand: 'Samsung',
    category: 'Smartphones',
    images: ['https://cdn.example.com/s25.avif'],
    stock: 999,
    stock_quantity: 999,
    rating: 4.5,
    status: 'active',
    merchant_id: 'merchant-1',
    product_key_specs: {
      main_camera_mp: 50,
      battery_mah: 5000,
    },
  };

  it('normalizes a product with default fields', () => {
    const result = normalizeProduct(baseRawProduct);

    expect(result.id).toBe('prod-1');
    expect(result.name).toBe('Samsung Galaxy S25');
    expect(result.price).toBe(860000);
    expect(result.condition).toBe('new');
    expect(result.has_condition_offers).toBe(false);
  });

  it('maps has_condition_offers when true', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      has_condition_offers: true,
    });

    expect(result.has_condition_offers).toBe(true);
  });

  it('defaults has_condition_offers to false when undefined', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      has_condition_offers: undefined,
    });
    expect(result.has_condition_offers).toBe(false);
  });

  it('preserves available_conditions and variant_model when present', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      available_conditions: ['new', 'used'],
      variant_model: 'sku_matrix',
    });

    expect(result.available_conditions).toEqual(['new', 'used']);
    expect(result.variant_model).toBe('sku_matrix');
  });

  it('defaults available_conditions and variant_model when missing', () => {
    const result = normalizeProduct(baseRawProduct);

    expect(result.available_conditions).toEqual([]);
    expect(result.variant_model).toBe('legacy');
  });

  it('defaults condition to New when missing', () => {
    const { condition: _, ...noCondition } = baseRawProduct;
    const result = normalizeProduct(noCondition);
    expect(result.condition).toBe('New');
  });

  it('treats unmanaged stock as available', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      manage_stock: false,
      stock: 0,
      stock_quantity: 0,
    });

    expect(result.availability).toBe('InStock');
  });

  it('treats nullable manage_stock as unmanaged stock', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      manage_stock: null,
      stock: 0,
      stock_quantity: 0,
    });

    expect(result.availability).toBe('InStock');
  });

  it('treats managed stock with zero quantity as out of stock', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      manage_stock: true,
      stock: 0,
      stock_quantity: 0,
    });

    expect(result.availability).toBe('OutOfStock');
  });

  it('treats managed stock with positive quantity as in stock', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      manage_stock: true,
      stock: 10,
      stock_quantity: 10,
    });

    expect(result.availability).toBe('InStock');
  });

  it('preserves product_key_specs when present', () => {
    const result = normalizeProduct(baseRawProduct);

    expect(result.product_key_specs).toEqual({
      main_camera_mp: 50,
      battery_mah: 5000,
    });
  });

  it('normalizes embedded product_key_specs relation rows', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      product_key_specs: [
        {
          main_camera_mp: 50,
          battery_mah: 5000,
        },
      ],
    });

    expect(result.product_key_specs).toEqual({
      main_camera_mp: 50,
      battery_mah: 5000,
    });
  });

  it('normalizes empty embedded product_key_specs relation rows to null', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      product_key_specs: [],
    });

    expect(result.product_key_specs).toBeNull();
  });

  it('uses the first embedded product_key_specs relation row deterministically', () => {
    const result = normalizeProduct({
      ...baseRawProduct,
      product_key_specs: [
        {
          main_camera_mp: 50,
          battery_mah: 5000,
        },
        {
          main_camera_mp: 12,
          battery_mah: 3000,
        },
      ],
    });

    expect(result.product_key_specs).toEqual({
      main_camera_mp: 50,
      battery_mah: 5000,
    });
  });

  it('prefers a matching category slug when provided', () => {
    const result = normalizeProduct(
      {
        ...baseRawProduct,
        category: undefined,
        categories: [
          {
            name: 'Accessories',
            slug: 'accessories',
          },
          {
            name: 'Smartphones',
            slug: 'smartphones',
          },
        ],
      },
      {
        preferredCategorySlug: 'smartphones',
      }
    );

    expect(result.category).toBe('Smartphones');
    expect(result.category_slug).toBe('smartphones');
  });

  it('matches preferredCategorySlug against legacy raw.category when joined categories do not match or are absent', () => {
    const mismatchResult = normalizeProduct(
      {
        ...baseRawProduct,
        category: 'Smartphones',
        categories: [
          {
            name: 'Accessories',
            slug: 'accessories',
          },
        ],
      },
      {
        preferredCategorySlug: 'smartphones',
      }
    );

    expect(mismatchResult.category).toBe('Smartphones');
    expect(mismatchResult.category_slug).toBe('smartphones');

    const absentResult = normalizeProduct(
      {
        ...baseRawProduct,
        category: 'Smartphones',
        categories: [],
      },
      {
        preferredCategorySlug: 'smartphones',
      }
    );

    expect(absentResult.category).toBe('Smartphones');
    expect(absentResult.category_slug).toBe('smartphones');
  });
});
