import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), merchant: vi.fn() }));

vi.mock('@/hooks/useMerchant', () => ({ useMerchant: () => mocks.merchant() }));
vi.mock('@/lib/merchant-inbox-api', () => ({ searchInbox: mocks.search }));

import { inboxSearchKey } from '@/lib/inbox-query-keys';
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

/** Moves the fake clock forward and lets every resulting promise settle. */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/**
 * Moves the clock, then lets the chain of renders, effects and requests settle:
 * each page of a multi-page search is its own render-then-effect step.
 */
const settle = async (ms: number) => {
  await advance(ms);
  for (let i = 0; i < 10; i++) await advance(0);
};

const DEBOUNCE = 350;

beforeEach(() => {
  vi.useFakeTimers();
  // React Query hands results to React on a timer; run it at once instead so
  // the fake clock only has to drive the debounce.
  notifyManager.setScheduler((callback) => callback());
  vi.clearAllMocks();
  mocks.merchant.mockReturnValue({ merchant: { id: 'm1' } });
});

afterEach(() => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.useRealTimers();
});

describe('useInboxSearch', () => {
  it('searches nothing for a term shorter than two letters', async () => {
    const { result } = renderHook(() => useInboxSearch('a'), { wrapper });
    await advance(DEBOUNCE * 3);

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

    await advance(DEBOUNCE - 1);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);

    await advance(1);
    await advance(0);
    expect(mocks.search).toHaveBeenCalledWith('order', 1);
    expect(result.current.results).toHaveLength(1);
    expect(result.current.isPending).toBe(false);
  });

  it('bugfix: keeps looking past a page with no matches for this store', async () => {
    mocks.search
      .mockResolvedValueOnce({ results: [], hasMore: true, page: 1 })
      .mockResolvedValueOnce({ results: [hit(7)], hasMore: false, page: 2 });
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });

    await settle(DEBOUNCE + 100);

    expect(mocks.search).toHaveBeenNthCalledWith(1, 'order', 1);
    expect(mocks.search).toHaveBeenNthCalledWith(2, 'order', 2);
    expect(result.current.results).toHaveLength(1);
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
    await settle(DEBOUNCE + 100);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await settle(100);

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

    await settle(DEBOUNCE + 2000);

    expect(mocks.search.mock.calls.length).toBeLessThanOrEqual(6);
    expect(result.current.isPending).toBe(false);
    expect(result.current.results).toEqual([]);
  });

  it('reports an error when the search fails', async () => {
    mocks.search.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });

    await settle(DEBOUNCE + 100);

    expect(result.current.isError).toBe(true);
    expect(result.current.results).toEqual([]);
  });

  it('does not search until the merchant is known', async () => {
    mocks.merchant.mockReturnValue({ merchant: null });
    renderHook(() => useInboxSearch('order'), { wrapper });

    await advance(DEBOUNCE * 3);

    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('bugfix: stops requesting once a page fails and lets the person retry', async () => {
    mocks.search
      .mockResolvedValueOnce({ results: [], hasMore: true, page: 1 })
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ results: [hit(3)], hasMore: false, page: 2 });
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });

    await settle(DEBOUNCE + 100);
    expect(result.current.isError).toBe(true);
    await settle(2000);
    // Page 1, then the failing page 2 once: no loop on the failing request.
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(result.current.isPending).toBe(false);

    act(() => result.current.retry());
    await settle(100);

    expect(result.current.results).toHaveLength(1);
    expect(result.current.isError).toBe(false);
  });

  it('keeps showing results when a later page fails', async () => {
    mocks.search
      .mockResolvedValueOnce({ results: [hit(1)], hasMore: true, page: 1 })
      .mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });
    await settle(DEBOUNCE + 100);

    act(() => result.current.loadMore());
    await settle(100);

    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(result.current.results).toHaveLength(1);
    expect(result.current.isError).toBe(false);
  });

  it('bugfix: retrying a failed next page asks for that page, not the first again', async () => {
    mocks.search
      .mockResolvedValueOnce({ results: [hit(1)], hasMore: true, page: 1 })
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ results: [hit(2)], hasMore: false, page: 2 });
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });
    await settle(DEBOUNCE + 100);
    act(() => result.current.loadMore());
    await settle(100);
    expect(mocks.search).toHaveBeenCalledTimes(2);

    act(() => result.current.retry());
    await settle(100);

    // Reloading from the first page would leave page 2 never fetched.
    expect(mocks.search).toHaveBeenCalledTimes(3);
    expect(mocks.search).toHaveBeenLastCalledWith('order', 2);
    expect(result.current.results.map((r) => r.conversation.id)).toEqual([
      1, 2,
    ]);
  });

  it('bugfix: does not ask for the failed page again on every scroll to the end', async () => {
    mocks.search
      .mockResolvedValueOnce({ results: [hit(1)], hasMore: true, page: 1 })
      .mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useInboxSearch('order'), { wrapper });
    await settle(DEBOUNCE + 100);
    act(() => result.current.loadMore());
    await settle(100);
    expect(result.current.loadMoreFailed).toBe(true);

    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    await settle(100);

    // Only the owner's tap on retry asks again.
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  it('bugfix: waits for a refresh of cached empty pages instead of cancelling it', async () => {
    // A stale cached search whose pages had no match, with more still to come.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      inboxSearchKey('m1', 'order'),
      {
        pages: [{ results: [], hasMore: true, page: 1 }],
        pageParams: [1],
      },
      { updatedAt: 0 }
    );
    let finish: (value: unknown) => void = () => {};
    mocks.search.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useInboxSearch('order'), {
      wrapper: shared,
    });

    await settle(DEBOUNCE + 100);

    // Only the refresh of page 1 is running: skipping on to page 2 would
    // cancel it and keep the stale empty page.
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledWith('order', 1);

    await act(async () => {
      finish({ results: [hit(5)], hasMore: false, page: 1 });
    });
    await settle(100);
    expect(result.current.results.map((r) => r.conversation.id)).toEqual([5]);
  });
});
