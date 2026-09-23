import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { useCategoryFiltering } from './use-category-filtering';

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    name: 'Test Laptop',
    slug: 'test-laptop',
    description: 'A test laptop',
    price: '₦100',
    rawPrice: 100,
    image: 'https://cdn.example.com/test.avif',
    condition: 'New',
    ...overrides,
  } as Product;
}

describe('useCategoryFiltering', () => {
  it('starts from an empty filter state', () => {
    const { result } = renderHook(() => useCategoryFiltering([]));

    expect(result.current.filters).toMatchObject({
      brand: [],
      graphics: [],
      minPrice: 0,
      maxPrice: 0,
    });
    expect(result.current.filteredProducts).toEqual([]);
  });

  it('derives sorted graphics options from the category products', () => {
    const { result } = renderHook(() =>
      useCategoryFiltering([
        buildProduct({ graphics: 'NVIDIA RTX 4070' }),
        buildProduct({ id: 'p-2', graphics: 'Integrated Graphics' }),
      ])
    );

    expect(result.current.availableOptions.graphics).toEqual([
      'Integrated Graphics',
      'NVIDIA RTX 4070',
    ]);
  });

  it('filters products by the selected graphics facet', () => {
    const { result } = renderHook(() =>
      useCategoryFiltering([
        buildProduct({ graphics: 'NVIDIA RTX 4070' }),
        buildProduct({ id: 'p-2', graphics: 'Integrated Graphics' }),
      ])
    );

    act(() => {
      result.current.setFilters((prev) => ({
        ...prev,
        graphics: ['NVIDIA RTX 4070'],
      }));
    });

    expect(result.current.filteredProducts.map((p) => p.id)).toEqual(['p-1']);
  });

  it('resets to the initial state on clear', () => {
    const { result } = renderHook(() =>
      useCategoryFiltering([buildProduct()])
    );

    act(() => {
      result.current.setFilters((prev) => ({ ...prev, brand: ['Apple'] }));
    });
    expect(result.current.filters.brand).toEqual(['Apple']);

    act(() => {
      result.current.setFilters(result.current.initialFilterState);
    });
    expect(result.current.filters.brand).toEqual([]);
  });
});
