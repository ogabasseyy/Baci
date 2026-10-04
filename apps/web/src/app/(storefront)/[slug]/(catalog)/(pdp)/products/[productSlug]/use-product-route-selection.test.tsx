import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { useProductRouteSelection } from './use-product-route-selection';

const mockUseSearchParams = vi.fn(() => new URLSearchParams());
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

const baseProduct = {
  id: 'p1',
  name: 'Phone',
  description: 'A phone',
  status: 'active',
  price: 100,
  manage_stock: true,
  stock: 10,
  image: '/p.jpg',
  imageLarge: '/p.jpg',
  imageHint: 'phone',
  brand: 'Acme',
  gtin: '1',
  mpn: '1',
  condition: 'new',
} as Product;

const variantProduct = {
  ...baseProduct,
  id: 'p2',
  has_variants: true,
  variants: [
    {
      id: 'v1',
      product_id: 'p2',
      merchant_id: 'm1',
      attributes: { storage: '128 GB' },
      price_override: 100,
      stock_quantity: 5,
    },
    {
      id: 'v2',
      product_id: 'p2',
      merchant_id: 'm1',
      attributes: { storage: '256 GB' },
      price_override: 150,
      stock_quantity: 5,
    },
  ],
} as unknown as Product;

describe('useProductRouteSelection', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  it('reports empty route inputs without params', () => {
    const { result } = renderHook(() => useProductRouteSelection(baseProduct));
    expect(result.current.routeCondition).toBe('');
    expect(result.current.routeVariantId).toBeUndefined();
    expect(result.current.offerIdParam).toBeNull();
    expect(result.current.routeSelectionAttributes).toEqual({});
    expect(result.current.usesVariantRouteSelection).toBe(false);
    expect(result.current.usesVariantConditions).toBe(false);
    expect(result.current.availableConditionOptions).toEqual([]);
  });

  it('parses condition and offer params on simple products', () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('condition=used&offer_id=o1')
    );
    const { result } = renderHook(() => useProductRouteSelection(baseProduct));
    expect(result.current.routeCondition).toBe('used');
    expect(result.current.offerIdParam).toBe('o1');
    expect(result.current.usesVariantRouteSelection).toBe(false);
  });

  it('parses variant selection params on variant products', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('variant_id=v2'));
    const { result } = renderHook(() =>
      useProductRouteSelection(variantProduct)
    );
    expect(result.current.usesVariantRouteSelection).toBe(true);
    expect(result.current.routeVariantId).toBe('v2');
  });
});
