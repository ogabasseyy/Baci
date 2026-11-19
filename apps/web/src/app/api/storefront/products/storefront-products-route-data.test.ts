import { describe, expect, it } from 'vitest';
import { storefrontProductsRouteData } from './storefront-products-route-data';

describe('storefrontProductsRouteData', () => {
  it('includes legacy condition aliases in SQL prefilter clauses', () => {
    expect(
      storefrontProductsRouteData.getConditionPrefilterClauses('open_box')
    ).toEqual(
      expect.arrayContaining([
        'condition.eq.open_box',
        'condition.eq.refurbished',
        'available_conditions.cs.{open_box}',
        'available_conditions.cs.{refurbished}',
      ])
    );
  });

  it('includes legacy offer fallbacks for new and used prefilters', () => {
    expect(
      storefrontProductsRouteData.getConditionPrefilterClauses('new')
    ).toEqual(
      expect.arrayContaining([
        'condition.eq.new',
        'available_conditions.cs.{new}',
        'has_condition_offers.eq.true',
      ])
    );

    expect(
      storefrontProductsRouteData.getConditionPrefilterClauses('used')
    ).toEqual(
      expect.arrayContaining([
        'condition.eq.used',
        'condition.eq.uk_used',
        'available_conditions.cs.{used}',
        'available_conditions.cs.{uk_used}',
        'has_condition_offers.eq.true',
      ])
    );
  });

  it('returns no SQL condition prefilter clauses for unsupported values', () => {
    expect(
      storefrontProductsRouteData.getConditionPrefilterClauses('bogus')
    ).toEqual([]);
  });

  it('preserves primary and secondary category memberships', () => {
    expect(
      storefrontProductsRouteData.buildCategoryFilterSource({
        category: 'Legacy Phones',
        categories: { name: 'Smartphones', slug: 'smartphones' },
        product_categories: [
          { categories: { name: 'Featured', slug: 'featured' } },
        ],
      })
    ).toEqual({
      category: 'Legacy Phones',
      categories: [
        { name: 'Smartphones', slug: 'smartphones' },
        { name: 'Featured', slug: 'featured' },
      ],
    });
  });

  it('includes assigned category names in compact product output', () => {
    const product = storefrontProductsRouteData.mapProduct({
      id: 'product-secondary-category',
      name: 'Galaxy S24',
      category: 'Featured',
      categories: { name: 'Featured', slug: 'featured' },
      product_categories: [
        { categories: { name: 'Smartphones', slug: 'smartphones' } },
      ],
    });

    expect(product.category_names).toEqual(['Featured', 'Smartphones']);
  });

  it('falls back to color_images keys when colors are absent', () => {
    expect(
      storefrontProductsRouteData.mapProduct({
        id: 'product-1',
        name: 'Console Cover',
        description: null,
        price: 12000,
        compare_at_price: null,
        images: ['https://example.com/image.jpg'],
        image_hint: null,
        category: 'Gaming',
        categories: { id: 'cat-1', name: 'Gaming', slug: 'gaming' },
        category_id: 'cat-1',
        brand: 'Sony',
        stock: 5,
        stock_quantity: 5,
        slug: 'console-cover',
        status: 'active',
        condition: 'new',
        has_variants: false,
        sku: 'CC-1',
        manage_stock: true,
        low_stock_threshold: 1,
        specifications: null,
        has_condition_offers: false,
        available_conditions: [],
        variant_model: 'single',
        offers: [],
        color_images: {
          Black: 'https://example.com/black.jpg',
          White: 'https://example.com/white.jpg',
        },
        variant_attributes: [],
      }).colors
    ).toEqual(['Black', 'White']);
  });

  it('prefers color_images keys over the singular color field when both are present', () => {
    expect(
      storefrontProductsRouteData.mapProduct({
        id: 'product-1a',
        name: 'Gamepad',
        description: null,
        price: 12000,
        compare_at_price: null,
        images: ['https://example.com/image.jpg'],
        image_hint: null,
        category: 'Gaming',
        categories: { id: 'cat-1', name: 'Gaming', slug: 'gaming' },
        category_id: 'cat-1',
        brand: 'Sony',
        stock: 5,
        stock_quantity: 5,
        slug: 'gamepad',
        status: 'active',
        condition: 'new',
        has_variants: false,
        sku: 'GP-1',
        manage_stock: true,
        low_stock_threshold: 1,
        specifications: null,
        has_condition_offers: false,
        available_conditions: [],
        variant_model: 'single',
        offers: [],
        color: 'Black',
        color_images: {
          White: 'https://example.com/white.jpg',
          Blue: 'https://example.com/blue.jpg',
        },
        variant_attributes: [],
      }).colors
    ).toEqual(['White', 'Blue']);
  });

  it('falls back to the singular color field when denormalized colors are absent', () => {
    expect(
      storefrontProductsRouteData.mapProduct({
        id: 'product-1b',
        name: 'Pepper Mix',
        description: null,
        price: 4500,
        compare_at_price: null,
        images: ['https://example.com/pepper-mix.jpg'],
        image_hint: null,
        category: 'Spices',
        categories: { id: 'cat-2', name: 'Spices', slug: 'spices' },
        category_id: 'cat-2',
        brand: 'Foodseed',
        stock: 12,
        stock_quantity: 12,
        slug: 'pepper-mix',
        status: 'active',
        condition: 'new',
        has_variants: false,
        sku: 'PM-1',
        manage_stock: true,
        low_stock_threshold: 2,
        specifications: null,
        has_condition_offers: false,
        available_conditions: [],
        variant_model: 'single',
        offers: [],
        color: 'Red',
        variant_attributes: [],
      }).colors
    ).toEqual(['Red']);
  });

  it('splits comma-delimited color fallback values into discrete colors', () => {
    expect(
      storefrontProductsRouteData.mapProduct({
        id: 'product-1bb',
        name: 'Travel Mug',
        description: null,
        price: 4500,
        compare_at_price: null,
        images: ['https://example.com/travel-mug.jpg'],
        image_hint: null,
        category: 'Kitchen',
        categories: { id: 'cat-2b', name: 'Kitchen', slug: 'kitchen' },
        category_id: 'cat-2b',
        brand: 'Homeware',
        stock: 12,
        stock_quantity: 12,
        slug: 'travel-mug',
        status: 'active',
        condition: 'new',
        has_variants: false,
        sku: 'TM-1',
        manage_stock: true,
        low_stock_threshold: 2,
        specifications: null,
        has_condition_offers: false,
        available_conditions: [],
        variant_model: 'single',
        offers: [],
        color: 'Black, Red',
        variant_attributes: [],
      }).colors
    ).toEqual(['Black', 'Red']);
  });

  it('ignores malformed color_images values and falls back to the singular color field', () => {
    expect(
      storefrontProductsRouteData.mapProduct({
        id: 'product-1c',
        name: 'Body Lotion',
        description: null,
        price: 4500,
        compare_at_price: null,
        images: ['https://example.com/body-lotion.jpg'],
        image_hint: null,
        category: 'Beauty',
        categories: { id: 'cat-3', name: 'Beauty', slug: 'beauty' },
        category_id: 'cat-3',
        brand: 'Glow',
        stock: 12,
        stock_quantity: 12,
        slug: 'body-lotion',
        status: 'active',
        condition: 'new',
        has_variants: false,
        sku: 'BL-1',
        manage_stock: true,
        low_stock_threshold: 2,
        specifications: null,
        has_condition_offers: false,
        available_conditions: [],
        variant_model: 'single',
        offers: [],
        color: 'Gold',
        color_images: 'not-a-map',
        variant_attributes: [],
      }).colors
    ).toEqual(['Gold']);
  });

  it('falls back to the singular color field when color_images has no usable keys', () => {
    expect(
      storefrontProductsRouteData.mapProduct({
        id: 'product-1ca',
        name: 'Yoga Mat',
        description: null,
        price: 6500,
        compare_at_price: null,
        images: ['https://example.com/yoga-mat.jpg'],
        image_hint: null,
        category: 'Fitness',
        categories: { id: 'cat-3a', name: 'Fitness', slug: 'fitness' },
        category_id: 'cat-3a',
        brand: 'Zen',
        stock: 12,
        stock_quantity: 12,
        slug: 'yoga-mat',
        status: 'active',
        condition: 'new',
        has_variants: false,
        sku: 'YM-1',
        manage_stock: true,
        low_stock_threshold: 2,
        specifications: null,
        has_condition_offers: false,
        available_conditions: [],
        variant_model: 'single',
        offers: [],
        color: 'Green',
        color_images: {},
        variant_attributes: [],
      }).colors
    ).toEqual(['Green']);
  });

  it('maps product_key_specs and updated_at into full storefront product responses', () => {
    const mapped = storefrontProductsRouteData.mapProduct({
      id: 'product-specs',
      name: 'Spec Phone',
      description: 'Spec phone description',
      price: 1000,
      compare_at_price: null,
      images: [],
      category: 'Smartphones',
      brand: 'SpecBrand',
      slug: 'spec-phone',
      status: 'active',
      manage_stock: false,
      updated_at: '2026-06-06T12:00:00.000Z',
      product_key_specs: {
        screen_size_inches: 6.8,
        ram_gb: 12,
        storage_gb: 256,
      },
    });

    expect(mapped.updated_at).toBe('2026-06-06T12:00:00.000Z');
    expect(mapped.product_key_specs).toEqual({
      screen_size_inches: 6.8,
      ram_gb: 12,
      storage_gb: 256,
    });
  });

  it('prefers normalized product_key_specs when the raw relation payload is valid', () => {
    const mapped = storefrontProductsRouteData.mapProduct({
      id: 'product-specs-array',
      name: 'Spec Phone Array',
      description: 'Spec phone description',
      price: 1000,
      images: [],
      category: 'Smartphones',
      slug: 'spec-phone-array',
      manage_stock: false,
      product_key_specs: [
        {
          screen_size_inches: 6.8,
          ram_gb: 12,
          nested_value_ignored: { raw: true },
        },
      ],
    });

    expect(mapped.product_key_specs).toEqual({
      screen_size_inches: 6.8,
      ram_gb: 12,
    });
  });

  it('falls back to raw product_key_specs only when normalization returns null', () => {
    const rawSpecs = { nested_value: { raw: true } };
    const mapped = storefrontProductsRouteData.mapProduct({
      id: 'product-specs-raw-fallback',
      name: 'Spec Phone Raw Fallback',
      description: 'Spec phone description',
      price: 1000,
      images: [],
      category: 'Smartphones',
      slug: 'spec-phone-raw-fallback',
      manage_stock: false,
      product_key_specs: rawSpecs,
    });

    expect(mapped.product_key_specs).toBe(rawSpecs);
  });

  it('omits product_key_specs when neither normalized nor raw specs exist', () => {
    const mapped = storefrontProductsRouteData.mapProduct({
      id: 'product-no-specs',
      name: 'Spec Phone Without Specs',
      description: 'Spec phone description',
      price: 1000,
      images: [],
      category: 'Smartphones',
      slug: 'spec-phone-no-specs',
      manage_stock: false,
    });

    expect(mapped.product_key_specs).toBeUndefined();
  });

  it('selects the singular color column for storefront queries', () => {
    expect(storefrontProductsRouteData.STOREFRONT_PRODUCTS_SELECT).toMatch(
      /\bcolor\b/
    );
    expect(storefrontProductsRouteData.STOREFRONT_PRODUCTS_SELECT).not.toMatch(
      /\bcolors\b/
    );
  });

  it('maps unmanaged stock as purchasable for agents', () => {
    const mapped = storefrontProductsRouteData.mapProduct({
      id: 'product-3',
      name: 'Riversong Watch',
      description: 'Daily tracking smartwatch.',
      price: 30600,
      compare_at_price: null,
      images: [],
      image_hint: null,
      category: 'Smartwatches',
      category_id: null,
      slug: 'riversong-watch',
      stock: 0,
      stock_quantity: 0,
      manage_stock: false,
      status: 'active',
      condition: 'new',
    });

    expect(mapped.availability).toBe('in_stock');
    expect(mapped.inventory_policy).toBe('untracked');
    expect(mapped.is_purchasable).toBe(true);
    expect(mapped.quantity_available).toBeNull();
  });

  it('treats nullable manage_stock as unmanaged stock for agents', () => {
    const mapped = storefrontProductsRouteData.mapProduct({
      id: 'product-null-stock',
      name: 'Legacy Stock Item',
      description: 'Legacy row without explicit stock tracking.',
      price: 30600,
      compare_at_price: null,
      images: [],
      image_hint: null,
      category: 'Smartwatches',
      category_id: null,
      slug: 'legacy-stock-item',
      stock: 0,
      stock_quantity: 0,
      manage_stock: null,
      status: 'active',
      condition: 'new',
    });

    expect(mapped.manage_stock).toBe(false);
    expect(mapped.availability).toBe('in_stock');
    expect(mapped.inventory_policy).toBe('untracked');
    expect(mapped.is_purchasable).toBe(true);
    expect(mapped.quantity_available).toBeNull();
  });

  it('preserves explicit image order zero values', () => {
    expect(
      storefrontProductsRouteData.mapProduct({
        id: 'product-2',
        name: 'DualSense Controller',
        description: '',
        price: 85000,
        compare_at_price: null,
        images: [
          {
            url: 'https://example.com/controller.jpg',
            alt: 'Controller',
            order: 0,
          },
        ],
        image_hint: null,
        category: 'Gaming',
        categories: { id: 'cat-1', name: 'Gaming', slug: 'gaming' },
        category_id: 'cat-1',
        brand: 'Sony',
        stock: 5,
        stock_quantity: 5,
        slug: 'dualsense-controller',
        status: 'active',
        condition: 'new',
        has_variants: false,
        sku: 'DS-1',
        manage_stock: true,
        low_stock_threshold: 1,
        specifications: null,
        has_condition_offers: false,
        available_conditions: [],
        variant_model: 'single',
        offers: [],
        colors: ['White'],
        variant_attributes: [],
      }).images[0]?.order
    ).toBe(0);
  });
});
