import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Product } from '../../types';
import { useProductDetailsSelectionState } from './use-product-details-selection-state';

const baseProduct: Product = {
  id: 'product-1',
  name: 'Pixel 9',
  price: '₦5,000',
  rawPrice: 5000,
  image: 'https://example.com/default.jpg',
  images: [
    'https://example.com/default.jpg',
    'https://example.com/black.jpg',
    'https://example.com/silver.jpg',
  ],
  description: '<p>Phone description</p>',
  condition: 'new',
  category: 'Phones',
  colors: ['Black', 'Silver'],
  color_images: {
    Black: ['https://example.com/black.jpg'],
    Silver: ['https://example.com/silver.jpg'],
  },
  storage: ['128GB'],
} as Product;

const variantProduct = {
  ...baseProduct,
  has_variants: true,
  variant_attributes: { storage: ['128GB'] },
  variants: [
    {
      id: 'variant-black-used',
      condition: 'used',
      attributes: { color: 'Black', storage: '128GB' },
      price_override: 5000,
      stock_quantity: 4,
    },
    {
      id: 'variant-silver-open-box',
      condition: 'open_box',
      attributes: { color: 'Silver', storage: '128GB' },
      price_override: 4000,
      stock_quantity: 2,
    },
  ],
} as Product;

function makeSearchParams(query = ''): URLSearchParams {
  return new URLSearchParams(query);
}

describe('useProductDetailsSelectionState', () => {
  afterEach(() => {
    cleanup();
  });

  it('exposes normalized product data and available conditions', () => {
    const { result } = renderHook(() =>
      useProductDetailsSelectionState(baseProduct, makeSearchParams())
    );

    expect(result.current.productData.id).toBe('product-1');
    expect(result.current.availableConditions).toContain('new');
    expect(result.current.selectedCondition).toBe('new');
  });

  it('seeds a price-first default selection to the lowest-priced variant', () => {
    const { result } = renderHook(() =>
      useProductDetailsSelectionState(variantProduct, makeSearchParams())
    );

    // Silver is cheaper (4000 < 5000) so the price-first default seeds it.
    expect(
      result.current.currentVariantDisplaySelection?.variant.id
    ).toBe('variant-silver-open-box');
    expect(result.current.selectedColor).toBe(1);
    expect(result.current.selectedImage).toBe(1);
  });

  it('exposes selectedColor and the resolved selected image for the seed', () => {
    const { result } = renderHook(() =>
      useProductDetailsSelectionState(variantProduct, makeSearchParams())
    );

    expect(result.current.selectedColor).not.toBeNull();
    expect(typeof result.current.selectedImage).toBe('number');
  });

  it('builds variantSelectionAttributes from the seeded color and axes', () => {
    const { result } = renderHook(() =>
      useProductDetailsSelectionState(variantProduct, makeSearchParams())
    );

    expect(result.current.variantSelectionAttributes).toMatchObject({
      color: 'Silver',
      storage: '128GB',
    });
  });

  it('initializes the condition from a ?condition route param', () => {
    const { result } = renderHook(() =>
      useProductDetailsSelectionState(
        baseProduct,
        makeSearchParams('condition=used')
      )
    );

    expect(result.current.selectedCondition).toBe('used');
  });

  it('falls back to the base condition when the route param is invalid', () => {
    const { result } = renderHook(() =>
      useProductDetailsSelectionState(
        baseProduct,
        makeSearchParams('condition=not-a-condition')
      )
    );

    expect(result.current.selectedCondition).toBe('new');
  });

  it('reseeds selection when the product input changes between renders', () => {
    const { result, rerender } = renderHook(
      ({ product }: { product: Product }) =>
        useProductDetailsSelectionState(product, makeSearchParams()),
      { initialProps: { product: baseProduct } }
    );

    expect(result.current.selectedColor).toBeNull();

    rerender({ product: variantProduct });

    expect(result.current.selectedColor).toBe(1);
  });

  it('reseeds when a refreshed inventory policy changes which variant is purchasable', () => {
    const product = {
      ...variantProduct,
      manage_stock: false,
      variants: [
        { id: 'cheap', attributes: { color: 'Black' }, price_override: 100, stock_quantity: 0 },
        { id: 'available', attributes: { color: 'Silver' }, price_override: 200, stock_quantity: 1 },
      ],
    } as Product;
    const refreshedProduct = {
      ...product,
      variants: product.variants?.map((variant) =>
        variant.id === 'cheap'
          ? { ...variant, inventory_tracking_policy: 'serialized_strict' }
          : variant
      ),
    } as Product;
    const { result, rerender } = renderHook(
      ({ value }: { value: Product }) =>
        useProductDetailsSelectionState(value, makeSearchParams()),
      { initialProps: { value: product } }
    );

    expect(result.current.currentVariantDisplaySelection?.variant.id).toBe('cheap');

    rerender({ value: refreshedProduct });

    expect(result.current.currentVariantDisplaySelection?.variant.id).toBe('available');
  });
});
