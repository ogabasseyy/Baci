// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

// Importing api-client for real pulls RN transport internals the test
// environment cannot load ("Cannot read properties of undefined (EventEmitter)").
vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn().mockResolvedValue({
    category: { id: 'category-1', name: 'Phones', slug: 'phones' },
  }),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeText: (value: string, max: number) => value.slice(0, max),
}));

describe('useCreateCategory slug generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function createCategory(name: string) {
    const { useCreateCategory } = await import('./useCreateCategory');
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useCreateCategory(), { wrapper });

    return act(() => result.current.mutateAsync(name));
  }

  it('posts a route-compatible slug derived from the name', async () => {
    const { apiClient } = await import('@/lib/api-client');

    await createCategory('Mobile Phones');

    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/categories',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(
      (vi.mocked(apiClient).mock.calls[0]?.[1] as { body: string }).body
    );
    expect(body.slug).toBe('mobile-phones');
  });

  describe('bugfix: names with no ASCII characters produced an empty slug', () => {
    it('fails locally with an actionable message instead of POSTing a 400', async () => {
      const { apiClient } = await import('@/lib/api-client');

      // The old inline generator turned 手机 into '' and the route answered 400.
      await expect(createCategory('手机')).rejects.toThrow(
        /letters or numbers/i
      );
      expect(apiClient).not.toHaveBeenCalled();
    });

    it('bounds a very long name to the slug maximum the route accepts', async () => {
      const { apiClient } = await import('@/lib/api-client');

      await createCategory(`${'word '.repeat(60)}end`);

      const body = JSON.parse(
        (vi.mocked(apiClient).mock.calls[0]?.[1] as { body: string }).body
      );
      expect(body.slug.length).toBeLessThanOrEqual(120);
      expect(body.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    });
  });
});
