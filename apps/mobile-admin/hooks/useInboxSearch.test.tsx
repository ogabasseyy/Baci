import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), merchant: vi.fn() }));

vi.mock('@/hooks/useMerchant', () => ({ useMerchant: () => mocks.merchant() }));
vi.mock('@/lib/merchant-inbox-api', () => ({ searchInbox: mocks.search }));

import { useInboxSearch } from './useInboxSearch';

const hit = (id: number, snippet: string | null = 'order') => ({
  conversation: {
    id,
    status: 'open' as const,
    unreadCount: 0,
    customerName: `Shopper ${id}`,
    lastActivityAt: null,
    lastMessage: null,
  },
  snippet,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const WAIT = { timeout: 3000 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.merchant.mockReturnValue({ merchant: { id: 'm1' } });
});

describe('useInboxSearch', () => {
  it('searches nothing for a term shorter than two letters', async () => {
    const { result } = renderHook(() => useInboxSearch('a'), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(false);
    expect(result.current.results).toEqual([]);
  });

  it('waits for a pause in typing, then searches the trimmed term', async () => {
    mocks.search.mockResolvedValue({
      results: [hit(1)],
      hasMore: false,
      page: 1,
    });
    const { result } = renderHook(() => useInboxSearch('  order '), {
      wrapper,
    });

    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);

    await waitFor(() => expect(result.current.results).toHaveLength(1), WAIT);
    expect(mocks.search).toHaveBeenCalledWith('order', 1);
    expect(result.current.isPending).toBe(false);
  });

  it('bugfix: keeps looking past a page with no matches for this store', async () => {
    mocks.search
      .mockResolvedValueOnce({ results: [], hasMore: true, page: 1 })
      .mockResolvedValueOnce({ results: [hit(7)], hasMore: false, page: 2 });
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });

    await waitFor(() => expect(result.current.results).toHaveLength(1), WAIT);
    expect(mocks.search).toHaveBeenNthCalledWith(1, 'order', 1);
    expect(mocks.search).toHaveBeenNthCalledWith(2, 'order', 2);
    expect(result.current.isPending).toBe(false);
  });

  it('loads the next page on request and does not repeat a chat', async () => {
    mocks.search
      .mockResolvedValueOnce({ results: [hit(1)], hasMore: true, page: 1 })
      .mockResolvedValueOnce({
        results: [hit(1), hit(2)],
        hasMore: false,
        page: 2,
      });
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true), WAIT);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.results).toHaveLength(2), WAIT);
    expect(result.current.results.map((r) => r.conversation.id)).toEqual([
      1, 2,
    ]);
    expect(result.current.hasMore).toBe(false);
  });

  it('stops skipping empty pages after a few and reports no matches', async () => {
    mocks.search.mockImplementation((_term: string, page: number) =>
      Promise.resolve({ results: [], hasMore: true, page })
    );
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false), WAIT);
    expect(mocks.search.mock.calls.length).toBeLessThanOrEqual(6);
    expect(result.current.results).toEqual([]);
  });

  it('reports an error when the search fails', async () => {
    mocks.search.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), WAIT);
    expect(result.current.results).toEqual([]);
  });

  it('does not search until the merchant is known', async () => {
    mocks.merchant.mockReturnValue({ merchant: null });
    renderHook(() => useInboxSearch('order'), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
