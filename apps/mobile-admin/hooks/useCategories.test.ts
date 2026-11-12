// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  useMerchant: vi.fn(),
}));

vi.mock('./useMerchant', () => ({
  useMerchant: mocks.useMerchant,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.from },
}));

import { useCategories } from './useCategories';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

function createCategoryQuery(error: { message: string } | null = null) {
  const query = {
    data: error ? null : [{ id: 'category-1', name: 'Phones', slug: 'phones' }],
    error,
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
  };
  mocks.from.mockReturnValue(query);
  return query;
}

describe('useCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMerchant.mockReturnValue({ merchant: { id: 'merchant-1' } });
  });

  it('excludes only explicit tombstones so legacy null-active rows remain selectable', async () => {
    const query = createCategoryQuery();

    const { result } = renderHook(() => useCategories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(query.not).toHaveBeenCalledWith('is_active', 'is', false);
    expect(result.current.data).toEqual([
      { id: 'category-1', name: 'Phones', slug: 'phones' },
    ]);
  });

  it('surfaces category query failures', async () => {
    createCategoryQuery({ message: 'category query failed' });

    const { result } = renderHook(() => useCategories(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('category query failed'));
  });
});
