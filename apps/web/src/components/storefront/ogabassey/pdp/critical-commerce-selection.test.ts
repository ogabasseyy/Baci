import { describe, expect, it } from 'vitest';
import type { Product as CartProduct, ProductVariant } from '@/lib/products';
import {
  buildVariantCartProduct,
  compactVariantOptions,
  formatCriticalPrice,
  getVariantAxesWithMultipleOptions,
  normalizeCriticalVariantAttributes,
  normalizeCriticalVariantProduct,
  pickInitialSelectedAttributes,
} from './critical-commerce-selection';

const cartProduct: CartProduct = {
  brand: 'Dell',
  condition: 'used',
  description: 'Dell Alienware m18 R3',
  gtin: '',
  id: 'product-1',
  image: 'https://cdn.ogabassey.com/base.avif',
  imageHint: 'Dell Alienware m18 R3',
  imageLarge: 'https://cdn.ogabassey.com/base-large.avif',
  manage_stock: true,
  mpn: 'dell-alienware-m18-r3',
  name: 'Dell Alienware m18 R3',
  price: 237_674.42,
  status: 'active',
  stock: 4,
};

describe('critical commerce selection helpers', () => {
  it('formats the selected price for the PDP summary', () => {
    expect(formatCriticalPrice(278_418.6)).toContain('278,419');
    expect(formatCriticalPrice(0)).toContain('0');
    expect(formatCriticalPrice(99.99)).toContain('100');
    expect(formatCriticalPrice(1_000_000_000)).toContain('1,000,000,000');
  });

  it('formats the selected price in a non-NGN merchant currency when supplied', () => {
    const inrCurrency = { code: 'INR', symbol: '₹', locale: 'en-IN' };

    expect(formatCriticalPrice(999_900, inrCurrency)).toBe('₹9,99,900');
    expect(formatCriticalPrice(999_900, inrCurrency)).not.toContain('₦');
  });

  it('builds a variant cart product from resolved SKU state', () => {
    expect(
      buildVariantCartProduct(cartProduct, {
        attributes: { ram: '8GB', storage: '256GB' },
        condition: 'open_box',
        price: 278_418.6,
        storage: '256GB',
        variant: {
          attributes: { ram: '8GB', storage: '256GB' },
          id: 'variant-256-8',
          images: ['https://cdn.ogabassey.com/variant.avif'],
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      })
    ).toMatchObject({
      condition: 'open_box',
      image: 'https://cdn.ogabassey.com/variant.avif',
      imageLarge: 'https://cdn.ogabassey.com/variant.avif',
      price: 278_418.6,
      stock: 8,
    });
  });

  it('returns the original cart product when no variant selection exists', () => {
    expect(buildVariantCartProduct(cartProduct, null)).toBe(cartProduct);
  });

  it('falls back to base images when a variant has no image', () => {
    expect(
      buildVariantCartProduct(cartProduct, {
        attributes: { storage: '256GB' },
        price: 278_418.6,
        variant: {
          attributes: { storage: '256GB' },
          id: 'variant-256',
          images: [],
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      })
    ).toMatchObject({
      image: cartProduct.image,
      imageLarge: cartProduct.imageLarge,
    });
  });

  it('uses the selected variant primary image before image arrays', () => {
    expect(
      buildVariantCartProduct(cartProduct, {
        attributes: { color: 'Green' },
        price: 278_418.6,
        variant: {
          attributes: { color: 'Green' },
          id: 'variant-green',
          images: ['https://cdn.ogabassey.com/variant-gallery.avif'],
          merchant_id: 'merchant-1',
          primary_image: 'https://cdn.ogabassey.com/variant-primary.avif',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      })
    ).toMatchObject({
      image: 'https://cdn.ogabassey.com/variant-primary.avif',
      imageLarge: 'https://cdn.ogabassey.com/variant-primary.avif',
    });
  });

  it('falls back to base stock when a variant stock quantity is undefined', () => {
    expect(
      buildVariantCartProduct(cartProduct, {
        attributes: { storage: '256GB' },
        price: 278_418.6,
        variant: {
          attributes: { storage: '256GB' },
          id: 'variant-256',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: undefined,
        } as unknown as ProductVariant,
      })
    ).toMatchObject({
      stock: cartProduct.stock,
    });
  });

  it('removes undefined cart option values only', () => {
    expect(
      compactVariantOptions({
        color: undefined,
        condition: 'used',
        variantAttributes: { storage: '256GB' },
      })
    ).toEqual({
      condition: 'used',
      variantAttributes: { storage: '256GB' },
    });
  });

  it('normalizes critical variant attribute axes and values', () => {
    expect(
      normalizeCriticalVariantAttributes({
        ' ': 'Ignored',
        Battery: null,
        'SIM Type': ' eSIM Only ',
        Color: ' ',
        Camera: 48,
        RAM: '8GB  ',
        Storage: ' 256GB',
      })
    ).toEqual({
      ram: '8GB',
      sim_type: 'eSIM Only',
      storage: '256GB',
    });
    expect(normalizeCriticalVariantAttributes(null)).toEqual({});
    expect(normalizeCriticalVariantAttributes(undefined)).toEqual({});
  });

  it('normalizes all critical variant product attributes', () => {
    const variants: ProductVariant[] = [
      {
        attributes: { Color: ' Black ', Storage: '128GB' },
        id: 'variant-black',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 10,
      },
      {
        attributes: { RAM: ' 8GB ', 'SIM Type': 'Physical SIM' },
        id: 'variant-blue',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 8,
      },
    ];
    const productWithVariants = { ...cartProduct, variants };

    expect(normalizeCriticalVariantProduct(productWithVariants)).toMatchObject({
      variants: [
        {
          attributes: { color: 'Black', storage: '128GB' },
        },
        {
          attributes: { ram: '8GB', sim_type: 'Physical SIM' },
        },
      ],
    });
    expect(normalizeCriticalVariantProduct(cartProduct)).toBe(cartProduct);
  });

  it('applies the parent condition to critical variant rows that inherit it', () => {
    expect(
      normalizeCriticalVariantProduct({
        ...cartProduct,
        condition: 'new',
        variants: [
          {
            attributes: { Storage: '128GB' },
            id: 'variant-inherited-new',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 4,
          },
          {
            attributes: { Storage: '128GB' },
            condition: 'used',
            id: 'variant-used',
            merchant_id: 'merchant-1',
            product_id: 'product-1',
            stock_quantity: 2,
          },
        ],
      }).variants
    ).toEqual([
      expect.objectContaining({
        condition: 'new',
        id: 'variant-inherited-new',
      }),
      expect.objectContaining({
        condition: 'used',
        id: 'variant-used',
      }),
    ]);
  });

  it('applies single-option metadata axes to critical variant rows that omit them', () => {
    expect(
      normalizeCriticalVariantProduct(
        {
          ...cartProduct,
          variants: [
            {
              attributes: {},
              id: 'variant-metadata-only',
              merchant_id: 'merchant-1',
              product_id: 'product-1',
              stock_quantity: 4,
            },
          ],
        },
        { condition: ['new'], storage: ['128GB'] }
      ).variants
    ).toEqual([
      expect.objectContaining({
        attributes: { storage: '128GB' },
        id: 'variant-metadata-only',
      }),
    ]);
  });

  it('detects hidden axes with multiple SKU options', () => {
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { color: 'Black', storage: '128GB' },
          condition: 'used',
          id: 'variant-black',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { color: 'Blue', storage: '128GB' },
          condition: 'new',
          id: 'variant-blue',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual(['condition', 'color']);
  });

  it('normalizes condition aliases before requiring condition selection', () => {
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { storage: '128GB' },
          condition: 'uk_used' as unknown as ProductVariant['condition'],
          id: 'variant-uk-used',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { storage: '128GB' },
          condition: 'used',
          id: 'variant-used',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual([]);

    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { storage: '128GB' },
          condition: 'refurbished' as unknown as ProductVariant['condition'],
          id: 'variant-refurbished',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { storage: '128GB' },
          condition: 'open_box',
          id: 'variant-open-box',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual([]);
  });

  it('ignores attribute-backed condition values before requiring condition selection', () => {
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { condition: 'used', storage: '128GB' },
          id: 'variant-attribute-used',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { condition: 'new', storage: '128GB' },
          id: 'variant-attribute-new',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual([]);
  });

  it('canonicalizes legacy-cased SKU axes before requiring selections', () => {
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { RAM: '4GB', Storage: '128GB' },
          id: 'variant-128',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { ram: '8GB', storage: '256GB' },
          id: 'variant-256',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual(['ram', 'storage']);
  });

  it('ignores non-string variant axis values before requiring selections', () => {
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { Camera: 48 as never, storage: '128GB' },
          id: 'variant-128',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { Camera: 50 as never, storage: '256GB' },
          id: 'variant-256',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual(['storage']);
  });
  it('handles empty, single-valued, and multi-axis option sets', () => {
    expect(getVariantAxesWithMultipleOptions([])).toEqual([]);
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { color: 'Black', storage: '128GB' },
          id: 'variant-black',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { color: 'Black', storage: '128GB' },
          id: 'variant-black-2',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual([]);
    expect(
      getVariantAxesWithMultipleOptions([
        {
          attributes: { color: 'Black', storage: '128GB' },
          id: 'variant-black',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 10,
        },
        {
          attributes: { color: 'Blue', storage: '256GB' },
          id: 'variant-blue',
          merchant_id: 'merchant-1',
          product_id: 'product-1',
          stock_quantity: 8,
        },
      ])
    ).toEqual(['color', 'storage']);
  });

  it('keeps hidden attributes only when they came from the route', () => {
    const selection = {
      attributes: { color: 'Blue', ram: '8GB', storage: '256GB' },
      condition: 'used',
      price: 278_418.6,
      variant: {
        attributes: { color: 'Blue', ram: '8GB', storage: '256GB' },
        condition: 'used' as const,
        id: 'variant-blue',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 8,
      },
    };

    expect(
      pickInitialSelectedAttributes({
        renderableVariantAxes: ['storage', 'ram'],
        selection: null,
      })
    ).toEqual({});
    expect(
      pickInitialSelectedAttributes({
        renderableVariantAxes: ['storage', 'ram'],
        selection,
      })
    ).toEqual({ ram: '8GB', storage: '256GB' });
    expect(
      pickInitialSelectedAttributes({
        renderableVariantAxes: ['condition', 'storage', 'ram'],
        selection,
      })
    ).toEqual({ condition: 'used', ram: '8GB', storage: '256GB' });
    expect(
      pickInitialSelectedAttributes({
        explicitAttributes: { Color: 'Blue' },
        renderableVariantAxes: ['storage', 'ram'],
        selection,
      })
    ).toEqual({ color: 'Blue', ram: '8GB', storage: '256GB' });
  });
});
