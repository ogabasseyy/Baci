import { renderHook } from '@testing-library/react';
import type Fuse from 'fuse.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { useProductGridData } from './use-product-grid-data';

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrencyCompact: (value: number) => `$${value}`,
  }),
}));

const stubProducts = [
  {
    id: '1',
    name: 'Phone',
    brand: 'Acme',
    category: 'Phones',
    price: 100,
    status: 'active',
  },
  {
    id: '2',
    name: 'Laptop',
    brand: 'Acme',
    category: 'Laptops',
    price: 500,
    status: 'active',
  },
  {
    id: '3',
    name: 'Old Phone',
    brand: 'Retro',
    category: 'Phones',
    price: 10,
    status: 'archived',
  },
] as Product[];

function renderDataHook(overrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useProductGridData({
      products: stubProducts,
      filterType: 'category',
      selectedCategory: 'All',
      debouncedSearchQuery: undefined,
      serverSearchProductIds: [],
      limit: 12,
      isPreviewMode: false,
      fuse: null,
      navigationCategories: undefined,
      ...overrides,
    })
  );
}

describe('useProductGridData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives category, brand, and price filter options', () => {
    const { result: categories } = renderDataHook();
    expect(categories.current.filterOptions).toEqual(['Phones', 'Laptops']);

    const { result: brands } = renderDataHook({ filterType: 'brand' });
    expect(brands.current.filterOptions).toEqual(['Acme', 'Retro']);

    const { result: prices } = renderDataHook({ filterType: 'price' });
    expect(prices.current.filterOptions).toHaveLength(4);
  });

  it('prioritizes navigation categories in the pill order', () => {
    const { result } = renderDataHook({
      navigationCategories: [{ name: 'Laptops' }],
    });

    expect(result.current.categories).toEqual(['All', 'Laptops', 'Phones']);
  });

  it('orders live search results by server IDs', () => {
    const { result } = renderDataHook({
      debouncedSearchQuery: 'phone',
      serverSearchProductIds: ['2', '1'],
    });

    expect(result.current.searchResults.map((p) => p.id)).toEqual(['2', '1']);
  });

  it('searches the preview index and drops inactive products', () => {
    const fuse = {
      search: vi.fn(() => [
        { item: stubProducts[0] },
        { item: stubProducts[2] },
      ]),
    };
    const { result } = renderDataHook({
      debouncedSearchQuery: 'phone',
      isPreviewMode: true,
      fuse: fuse as unknown as Fuse<Product>,
    });

    expect(fuse.search).toHaveBeenCalledWith('phone');
    expect(result.current.searchResults.map((p) => p.id)).toEqual(['1']);
  });
});
