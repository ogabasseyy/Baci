import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), merchant: vi.fn() }));

vi.mock('@/hooks/useMerchant', () => ({ useMerchant: () => mocks.merchant() }));
vi.mock('@/lib/merchant-inbox-api', () => ({ searchInbox: mocks.search }));

import { inboxSearchKey } from '@/lib/inbox-query-keys';
import { useInboxSearch } from './useInboxSearch';
import {
  DEBOUNCE,
  hit,
  installSearchHarness,
  settle,
  uninstallSearchHarness,
} from './useInboxSearch.test-support';

beforeEach(() => installSearchHarness(mocks.merchant));
afterEach(() => uninstallSearchHarness());

describe('useInboxSearch: refreshing cached results', () => {
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

  it('bugfix: scrolling to the end during a refresh of cached results does not cancel the refresh', async () => {
    // Stale cached results with a next page, refreshing in the background.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      inboxSearchKey('m1', 'order'),
      {
        pages: [{ results: [hit(1)], hasMore: true, page: 1 }],
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
    expect(mocks.search).toHaveBeenCalledTimes(1);

    act(() => result.current.loadMore());
    await settle(100);

    // Page 2 was not asked for, so the refresh of page 1 was left to finish.
    expect(mocks.search).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ results: [hit(9)], hasMore: false, page: 1 });
    });
    await settle(100);
    expect(result.current.results.map((r) => r.conversation.id)).toEqual([9]);
  });

  it('bugfix: a retry tapped as a refresh starts does not cancel it', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    let finish: (value: unknown) => void = () => {};
    mocks.search
      .mockResolvedValueOnce({ results: [hit(1)], hasMore: true, page: 1 })
      .mockRejectedValueOnce(new Error('down'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
    const { result } = renderHook(() => useInboxSearch('order'), {
      wrapper: shared,
    });
    await settle(DEBOUNCE + 100);
    act(() => result.current.loadMore());
    await settle(100);
    // The footer's retry as it was on screen when the refresh began.
    const { retry, loadMoreFailed } = result.current;
    expect(loadMoreFailed).toBe(true);
    act(() => {
      client.refetchQueries();
    });
    await settle(100);

    act(() => retry());
    await settle(100);

    // Page 1, the failed page 2, and the refresh: nothing replaced it.
    expect(mocks.search).toHaveBeenCalledTimes(3);
    await act(async () => {
      finish({ results: [hit(9)], hasMore: false, page: 1 });
    });
    await settle(100);
    expect(result.current.results.map((r) => r.conversation.id)).toEqual([9]);
  });
});
