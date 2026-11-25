import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), merchant: vi.fn() }));

vi.mock('@/hooks/useMerchant', () => ({ useMerchant: () => mocks.merchant() }));
vi.mock('@/lib/merchant-inbox-api', () => ({
  fetchInboxConversations: mocks.fetch,
}));

import { useInboxConversations } from './useInboxConversations';

const chat = (id: number) => ({
  id,
  status: 'open' as const,
  unreadCount: 0,
  customerName: `Shopper ${id}`,
  lastActivityAt: null,
  lastMessage: null,
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.merchant.mockReturnValue({ merchant: { id: 'm1' } });
});

describe('useInboxConversations', () => {
  it('opens on the Needs reply view and asks the server for it', async () => {
    mocks.fetch.mockResolvedValue({
      conversations: [chat(1)],
      hasMore: false,
      page: 1,
    });
    const { result } = renderHook(() => useInboxConversations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.fetch).toHaveBeenCalledWith(1, 'needs_reply');
  });

  it('asks for the view it is given', async () => {
    mocks.fetch.mockResolvedValue({
      conversations: [],
      hasMore: false,
      page: 1,
    });
    const { result } = renderHook(() => useInboxConversations('follow_up'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.fetch).toHaveBeenCalledWith(1, 'follow_up');
  });

  it('keeps a separate cache entry per view and merchant', async () => {
    mocks.fetch.mockResolvedValue({
      conversations: [chat(1)],
      hasMore: false,
      page: 1,
    });
    const needs = renderHook(() => useInboxConversations('needs_reply'), {
      wrapper,
    });
    const done = renderHook(() => useInboxConversations('done'), { wrapper });
    await waitFor(() => expect(needs.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(done.result.current.isSuccess).toBe(true));

    const keys = client
      .getQueryCache()
      .findAll({ queryKey: ['inbox-conversations', 'm1'] })
      .map((q) => q.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['inbox-conversations', 'm1', 'needs_reply'],
        ['inbox-conversations', 'm1', 'done'],
      ])
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('pages on while the server says there are more, and stops at the last page', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        conversations: [chat(1)],
        hasMore: true,
        page: 1,
      })
      .mockResolvedValueOnce({
        conversations: [chat(2)],
        hasMore: false,
        page: 2,
      });
    const { result } = renderHook(() => useInboxConversations('all'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(mocks.fetch).toHaveBeenLastCalledWith(2, 'all');
    expect(result.current.data?.pages).toHaveLength(2);
  });

  it('does not ask until the merchant is known', () => {
    mocks.merchant.mockReturnValue({ merchant: null });
    const { result } = renderHook(() => useInboxConversations(), { wrapper });
    // The query is switched off, so it never starts: no waiting needed.
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reports an error when the list cannot be loaded', async () => {
    mocks.fetch.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useInboxConversations(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

/** Loads `pages` pages, then counts the requests made over the next waits. */
async function pollingAfter(pages: number) {
  vi.useFakeTimers();
  mocks.fetch.mockImplementation((page: number) =>
    Promise.resolve({ conversations: [chat(page)], hasMore: true, page })
  );
  const { result } = renderHook(() => useInboxConversations(), { wrapper });
  const wait = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  await wait(10);
  for (let page = 2; page <= pages; page += 1) {
    await act(async () => {
      await result.current.fetchNextPage();
    });
  }
  mocks.fetch.mockClear();
  return async (ms: number) => {
    await wait(ms);
    return mocks.fetch.mock.calls.length;
  };
}

describe('useInboxConversations polling', () => {
  afterEach(() => {
    client.clear();
    vi.useRealTimers();
  });

  it('checks a one-page store every 30 seconds', async () => {
    // Its chats and the empty page that ends them.
    const requestsAfter = await pollingAfter(2);

    expect(await requestsAfter(30_000)).toBe(2);
  });

  it('bugfix: polls less often the more pages a refresh has to ask for', async () => {
    // A refresh asks for every loaded page again.
    const requestsAfter = await pollingAfter(5);

    expect(await requestsAfter(90_000)).toBe(0);
    expect(await requestsAfter(30_000)).toBe(5);
  });
});
