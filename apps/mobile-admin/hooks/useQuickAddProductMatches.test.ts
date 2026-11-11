// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuickAddProductMatches } from './useQuickAddProductMatches';

const mocks = vi.hoisted(() => ({
  fetchAdminProductSearchRows: vi.fn(),
  fetchAdminProductVariants: vi.fn(),
  merchant: { id: 'merchant-1' } as { id: string } | null,
  useDebounce: vi.fn((value: string) => value),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: mocks.useDebounce,
}));

vi.mock('@/lib/product-search', () => ({
  fetchAdminProductSearchRows: mocks.fetchAdminProductSearchRows,
}));

vi.mock('@/hooks/useProductPickerVariants', () => ({
  fetchAdminProductVariants: mocks.fetchAdminProductVariants,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  }

  return Wrapper;
}

describe('useQuickAddProductMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant = { id: 'merchant-1' };
    mocks.useDebounce.mockImplementation((value) => value);
    mocks.fetchAdminProductSearchRows.mockResolvedValue({
      nextCursor: null,
      rows: [
        {
          condition: null,
          has_variants: true,
          id: 'iphone-11-pro',
          images: [],
          name: 'iPhone 11 Pro',
          parent_product_id: null,
          price: 450000,
          sku: null,
          variant_attributes: null,
        },
      ],
      totalCount: 1,
    });
    mocks.fetchAdminProductVariants.mockResolvedValue([
      {
        condition: 'used',
        cost_price: null,
        has_variants: false,
        id: 'variant-1',
        images: [],
        name: 'iPhone 11 Pro 64GB Premium Used',
        parent_product_id: 'iphone-11-pro',
        price: 180000,
        primary_image: null,
        sku: 'IPH-11P-64-PU',
        source: 'structured',
        stock_quantity: 1,
        variant_attributes: { storage: '64GB', condition: 'Premium Used' },
      },
    ]);
  });

  it('fetches products, expands variants, and ranks quick-add matches', async () => {
    const { result } = renderHook(
      () =>
        useQuickAddProductMatches({
          name: 'iPhone 11 Pro 64gb Premium Used',
          price: '180000',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.matches[0]).toMatchObject({
        id: 'variant-1',
        matchReason: 'variant-and-price',
      });
    });

    expect(mocks.fetchAdminProductSearchRows).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        pageSize: 10,
      })
    );
    expect(mocks.fetchAdminProductVariants).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      parentProduct: expect.objectContaining({ id: 'iphone-11-pro' }),
    });
  });

  it('queries with the debounced quick-add name instead of raw keystrokes', async () => {
    mocks.useDebounce.mockReturnValue('iPhone 11 Pro');

    renderHook(
      () =>
        useQuickAddProductMatches({
          name: 'iPhone 11 Pro 6',
          price: '180000',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(mocks.fetchAdminProductSearchRows).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: { search: 'iPhone 11 Pro' },
        })
      );
    });
    expect(mocks.useDebounce).toHaveBeenCalledWith('iPhone 11 Pro 6', 300);
  });

  it('reuses fresh quick-add results when the hook remounts', async () => {
    const Wrapper = createWrapper();
    const props = {
      name: 'iPhone 11 Pro 64gb Premium Used',
      price: '180000',
    };
    const firstRender = renderHook(() => useQuickAddProductMatches(props), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(firstRender.result.current.matches[0]?.id).toBe('variant-1');
    });
    firstRender.unmount();

    const secondRender = renderHook(() => useQuickAddProductMatches(props), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(secondRender.result.current.matches[0]?.id).toBe('variant-1');
    });

    expect(mocks.fetchAdminProductSearchRows).toHaveBeenCalledTimes(1);
    expect(mocks.fetchAdminProductVariants).toHaveBeenCalledTimes(1);
  });

  it('does not query until the quick-add name has at least two characters', () => {
    const { result } = renderHook(
      () => useQuickAddProductMatches({ name: 'i', price: '180000' }),
      { wrapper: createWrapper() }
    );

    expect(result.current.matches).toEqual([]);
    expect(mocks.fetchAdminProductSearchRows).not.toHaveBeenCalled();
    expect(mocks.fetchAdminProductVariants).not.toHaveBeenCalled();
  });

  it('returns empty matches when product search fails', async () => {
    mocks.fetchAdminProductSearchRows.mockRejectedValueOnce(
      new Error('search failed')
    );

    const { result } = renderHook(
      () =>
        useQuickAddProductMatches({
          name: 'iPhone 11 Pro',
          price: '180000',
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.matches).toEqual([]);
    expect(mocks.fetchAdminProductVariants).not.toHaveBeenCalled();
  });
});
