// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useDebounce: vi.fn(),
  useProducts: vi.fn(),
}));

vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: mocks.useDebounce,
}));

vi.mock('@/hooks/useProducts', () => ({
  useProducts: mocks.useProducts,
}));

import { useProductPicker } from './useProductPicker';

describe('useProductPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDebounce.mockImplementation((value) => value);
    mocks.useProducts.mockReturnValue({ data: { pages: [] } });
  });

  it('passes trimmed debounced search into the products query', () => {
    mocks.useDebounce.mockReturnValue(' phone ');

    renderHook(() => useProductPicker('phone'));

    expect(mocks.useDebounce).toHaveBeenCalledWith('phone', 150);
    expect(mocks.useProducts).toHaveBeenCalledWith({ search: 'phone' });
  });

  it('omits the search param when the debounced query trims empty', () => {
    mocks.useDebounce.mockReturnValue('   ');

    renderHook(() => useProductPicker('   '));

    expect(mocks.useProducts).toHaveBeenCalledWith({ search: undefined });
  });

  it('dedupes repeated product ids before exposing picker rows', () => {
    const firstPhone = { id: 'phone-1', name: 'Baci Phone' };
    const duplicatePhone = { id: 'phone-1', name: 'Baci Phone duplicate' };
    const laptop = { id: 'laptop-1', name: 'Baci Laptop' };
    const tablet = { id: 'tablet-1', name: 'Baci Tablet' };

    mocks.useProducts.mockReturnValue({
      data: {
        pages: [
          { products: [firstPhone, duplicatePhone, laptop] },
          { products: [laptop, tablet] },
        ],
      },
    });

    const { result } = renderHook(() => useProductPicker(''));

    expect(result.current.products).toEqual([firstPhone, laptop, tablet]);
  });

  it('returns an empty product list when product pages have not loaded', () => {
    mocks.useProducts.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useProductPicker(''));

    expect(result.current.products).toEqual([]);
  });

  it('preserves the server page order while browsing (no client re-sort)', () => {
    // fetchProducts pages by created_at desc before .range(...), so a client-side
    // sort would only reorder loaded pages and shuffle as more pages arrive.
    const zed = { id: 'zed-phone', name: 'Zed Phone' };
    const alpha = { id: 'alpha-phone', name: 'Alpha Phone' };
    const beta = { id: 'beta-phone', name: 'beta Phone' };

    mocks.useProducts.mockReturnValue({
      data: {
        pages: [{ products: [zed, alpha, beta] }],
      },
    });

    const { result } = renderHook(() => useProductPicker(''));

    expect(result.current.products).toEqual([zed, alpha, beta]);
  });

  it('preserves relevance order (no alpha sort) while a search query is active', () => {
    // search_products_v2 returns the strongest match first; the picker must keep
    // that ranking rather than re-sorting the drawer alphabetically.
    const zed = { id: 'zed-phone', name: 'Zed Phone' };
    const alpha = { id: 'alpha-phone', name: 'Alpha Phone' };
    mocks.useDebounce.mockReturnValue('phone');

    mocks.useProducts.mockReturnValue({
      data: {
        pages: [{ products: [zed, alpha] }],
      },
    });

    const { result } = renderHook(() => useProductPicker('phone'));

    expect(result.current.products).toEqual([zed, alpha]);
  });
});
