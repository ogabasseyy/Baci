import { describe, expect, it } from 'vitest';
import type { Product as CartProduct } from '@/lib/products';
import { resolveCriticalDefaultAndDisplaySelection } from './resolve-critical-default-and-display-selection';

const baseProduct: CartProduct = {
  id: 'prod-1',
  name: 'Test Phone',
  slug: 'test-phone',
  price: 500000,
  has_variants: true,
  variants: [
    {
      id: 'var-1',
      price: 600000,
      in_stock: true,
      condition: 'new',
      attributes: { Color: 'Black', Storage: '128GB' },
    },
    {
      id: 'var-2',
      price: 500000,
      in_stock: true,
      condition: 'used',
      attributes: { Color: 'White', Storage: '128GB' },
    },
    {
      id: 'var-3',
      price: 700000,
      in_stock: true,
      condition: 'new',
      attributes: { Color: 'Gold', Storage: '256GB' },
    },
  ],
} as unknown as CartProduct;

describe('resolveCriticalDefaultAndDisplaySelection', () => {
  it('returns null selections when product has no variants', () => {
    const noVariantProduct = {
      ...baseProduct,
      has_variants: false,
    };
    const result = resolveCriticalDefaultAndDisplaySelection({
      initialResolverAttributes: {},
      selectionCartProduct: noVariantProduct,
      variants: [],
    });

    expect(result.defaultVariantSelection).toBeNull();
    expect(result.initialDisplayVariantSelection).toBeNull();
  });

  it('resolves lowest priced variant when no condition is specified', () => {
    const result = resolveCriticalDefaultAndDisplaySelection({
      initialResolverAttributes: {},
      selectionCartProduct: baseProduct,
      variants: baseProduct.variants ?? [],
    });

    expect(result.defaultVariantSelection).not.toBeNull();
    expect(result.defaultVariantSelection?.variant?.id).toBe('var-2');
  });

  it('resolves variant matching explicitVariantCondition', () => {
    const result = resolveCriticalDefaultAndDisplaySelection({
      explicitVariantCondition: 'new',
      initialResolverAttributes: {},
      selectionCartProduct: baseProduct,
      variants: baseProduct.variants ?? [],
    });

    expect(result.defaultVariantSelection).not.toBeNull();
    expect(result.defaultVariantSelection?.variant?.condition).toBe('new');
    expect(result.defaultVariantSelection?.variant?.id).toBe('var-1');
  });

  it('resolves initial display selection by variantId when specified', () => {
    const result = resolveCriticalDefaultAndDisplaySelection({
      initialResolverAttributes: {},
      initialVariantSelection: { variantId: 'var-3' },
      selectionCartProduct: baseProduct,
      variants: baseProduct.variants ?? [],
    });

    expect(result.initialDisplayVariantSelection?.variant?.id).toBe('var-3');
  });
});
