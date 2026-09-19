import { describe, expect, it } from 'vitest';
import {
  buildProductPriceSeoCopy,
  formatProductPriceRange,
  getProductPriceRange,
} from '@/lib/storefront-product-price-seo';

describe('getProductPriceRange', () => {
  it('uses variants and condition offers to compute a product price range', () => {
    const range = getProductPriceRange({
      name: 'iPhone XR',
      price: 230000,
      variants: [
        { price_override: 180000 },
        { price_override: 220000 },
        { price_override: 300000 },
      ],
      offers: [{ price: 200000 }],
    });

    expect(range).toEqual({
      min: 180000,
      max: 300000,
      hasRange: true,
    });
  });

  it('ignores inactive condition offers when computing the advertised range', () => {
    const range = getProductPriceRange({
      name: 'iPhone XR',
      price: 230000,
      offers: [
        { price: 100000, status: 'archived' },
        { price: 210000, status: 'active' },
      ],
    });

    expect(range).toEqual({
      min: 210000,
      max: 230000,
      hasRange: true,
    });
  });

  it('ignores out-of-stock variants and offers when computing the advertised range', () => {
    const range = getProductPriceRange({
      name: 'iPhone XR',
      price: 230000,
      manage_stock: true,
      stock: 5,
      min_variant_price: 100000,
      variants: [
        { price_override: 100000, stock_quantity: 0 },
        { price_override: 210000, stock_quantity: 2 },
      ],
      offers: [
        { price: 90000, status: 'active', stock_quantity: 0 },
        { price: 220000, status: 'active', stock_quantity: 1 },
      ],
    });

    expect(range).toEqual({
      min: 210000,
      max: 230000,
      hasRange: true,
    });
  });

  it('excludes the parent price when selectable variants are required', () => {
    const range = getProductPriceRange({
      name: 'Galaxy S25',
      has_variants: true,
      price: 150000,
      manage_stock: true,
      stock: 5,
      variants: [{ price_override: 175000, stock_quantity: 2 }],
    });

    expect(range).toEqual({
      min: 175000,
      max: 175000,
      hasRange: false,
    });
  });

  it('uses the active sale price without treating base price as a range', () => {
    const range = getProductPriceRange({
      name: 'Samsung Galaxy A57',
      sale_price: 415000,
      base_price: 450000,
    });

    expect(range).toEqual({
      min: 415000,
      max: 415000,
      hasRange: false,
    });
  });

  it('keeps zero prices as valid promotional prices', () => {
    const range = getProductPriceRange({
      name: 'Launch Giveaway',
      price: 0,
    });

    expect(range).toEqual({
      min: 0,
      max: 0,
      hasRange: false,
    });
  });

  it('returns null when no usable price exists', () => {
    expect(
      getProductPriceRange({
        name: 'Custom Device',
        price: null,
        variants: [{ price_override: null }],
      })
    ).toBeNull();
  });
});

describe('formatProductPriceRange', () => {
  it('formats Nigerian currency without decimals', () => {
    expect(
      formatProductPriceRange(
        { min: 180000, max: 300000, hasRange: true },
        'NGN'
      )
    ).toBe('₦180,000 - ₦300,000');
  });

  it('formats single-price ranges with only the minimum price', () => {
    expect(
      formatProductPriceRange(
        { min: 180000, max: 300000, hasRange: false },
        'NGN'
      )
    ).toBe('₦180,000');
  });

  it('preserves minor currency units for decimal product prices', () => {
    expect(
      formatProductPriceRange(
        { min: 199.99, max: 249.5, hasRange: true },
        'USD',
        'en-US'
      )
    ).toBe('$199.99 - $249.50');
  });
});

describe('buildProductPriceSeoCopy', () => {
  it('builds exact-match device price copy for ranged product families', () => {
    const copy = buildProductPriceSeoCopy({
      product: {
        name: 'iPhone 13',
        price: 430000,
        min_variant_price: 390000,
        max_variant_price: 520000,
      },
      merchantDisplayName: 'Ogabassey',
      categoryName: 'Smartphones',
      currency: 'NGN',
      country: 'NG',
    });

    expect(copy.title).toBe('iPhone 13 Price in Nigeria');
    expect(copy.description).toContain(
      'iPhone 13 price in Nigeria starts from ₦390,000 on Ogabassey'
    );
    expect(copy.answer).toContain(
      'The iPhone 13 price in Nigeria on Ogabassey starts from ₦390,000 and goes up to ₦520,000'
    );
  });

  it('builds direct price copy for single-price products', () => {
    const copy = buildProductPriceSeoCopy({
      product: {
        name: 'HP Laptop 14',
        price: 645600,
      },
      merchantDisplayName: 'Ogabassey',
      categoryName: 'Laptops',
      currency: 'NGN',
      country: 'NG',
    });

    expect(copy.answer).toContain(
      'The HP Laptop 14 price in Nigeria on Ogabassey is ₦645,600'
    );
  });

  it('adds trailing slug storage tokens to distinguish variant PDP titles', () => {
    const copy = buildProductPriceSeoCopy({
      product: {
        name: 'Samsung Galaxy Tab S10 FE 5G',
        slug: 'samsung-galaxy-tab-s10-fe-5g-8gb-128gb',
        price: 780000,
      },
      merchantDisplayName: 'Ogabassey',
      categoryName: 'Tablets',
      currency: 'NGN',
      country: 'NG',
    });

    expect(copy.title).toBe(
      'Samsung Galaxy Tab S10 FE 5G 8GB 128GB Price in Nigeria'
    );
    expect(copy.description).toContain(
      'Samsung Galaxy Tab S10 FE 5G 8GB 128GB price in Nigeria is ₦780,000'
    );
  });

  it('spells plus-model titles with Plus to avoid crawler title normalization collisions', () => {
    const copy = buildProductPriceSeoCopy({
      product: {
        name: 'Samsung Galaxy Tab S9+',
        slug: 'samsung-galaxy-tab-s9-plus',
        price: 950000,
      },
      merchantDisplayName: 'Ogabassey',
      categoryName: 'Tablets',
      currency: 'NGN',
      country: 'NG',
    });

    expect(copy.title).toBe('Samsung Galaxy Tab S9 Plus Price in Nigeria');
  });

  it('adds currency codes to symbol-denominated gift card SEO copy', () => {
    const copy = buildProductPriceSeoCopy({
      product: {
        name: 'PSN Gift Card £50',
        slug: 'psn-gift-card-gbp-50',
        price: 85000,
      },
      merchantDisplayName: 'Ogabassey',
      categoryName: 'Gift Cards',
      currency: 'NGN',
      country: 'NG',
    });

    expect(copy.title).toBe('PSN Gift Card £50 GBP Price in Nigeria');
    expect(copy.description).toContain(
      'PSN Gift Card £50 GBP price in Nigeria is ₦85,000'
    );
  });

  it('builds generic check-price copy when no price is available', () => {
    const copy = buildProductPriceSeoCopy({
      product: {
        name: 'Custom Device',
        price: null,
      },
      merchantDisplayName: 'Ogabassey',
      categoryName: 'Electronics',
      currency: 'NGN',
      country: 'NG',
    });

    expect(copy.title).toBe('Custom Device Price in Nigeria');
    expect(copy.description).toContain(
      'Check Custom Device price in Nigeria on Ogabassey'
    );
    expect(copy.answer).toContain(
      'Check the current Custom Device price in Nigeria on Ogabassey'
    );
    expect(copy.priceText).toBeNull();
    expect(copy.range).toBeNull();
  });

  it('omits Nigeria copy and formats with the storefront locale for other countries', () => {
    const copy = buildProductPriceSeoCopy({
      product: {
        name: 'Pixel 10',
        price: 999,
      },
      merchantDisplayName: 'US Gadget Store',
      categoryName: 'Smartphones',
      currency: 'USD',
      country: 'us',
    });

    expect(copy.title).toBe('Pixel 10 Price');
    expect(copy.description).toBe(
      'Pixel 10 price is $999 on US Gadget Store. Check specs, condition, warranty, delivery, and flexible payment options before you buy.'
    );
    expect(copy.answer).toBe(
      'The Pixel 10 price on US Gadget Store is $999. Check specs, condition, warranty, delivery, and payment options before you buy.'
    );
  });
});
