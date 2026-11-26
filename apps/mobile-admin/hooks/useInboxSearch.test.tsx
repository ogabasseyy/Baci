import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), merchant: vi.fn() }));

vi.mock('@/hooks/useMerchant', () => ({ useMerchant: () => mocks.merchant() }));
vi.mock('@/lib/merchant-inbox-api', () => ({ searchInbox: mocks.search }));

import { useInboxSearch } from './useInboxSearch';
import {
  advance,
  DEBOUNCE,
  hit,
  installSearchHarness,
  settle,
  uninstallSearchHarness,
  wrapper,
} from './useInboxSearch.test-support';

beforeEach(() => installSearchHarness(mocks.merchant));
afterEach(() => uninstallSearchHarness());

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

  it("bugfix: does not show the last term's error while the next one is typed", async () => {
    mocks.search.mockRejectedValue(new Error('down'));
    const { result, rerender } = renderHook(
      ({ term }) => useInboxSearch(term),
      { initialProps: { term: 'order' }, wrapper }
    );
    await settle(DEBOUNCE + 100);
    expect(result.current.isError).toBe(true);

    rerender({ term: 'orders' });

    expect(result.current.isError).toBe(false);
    expect(result.current.isPending).toBe(true);
    await settle(DEBOUNCE + 100);
    // Searched and failed in its own right: now the error is about this term.
    expect(mocks.search).toHaveBeenLastCalledWith('orders', 1);
    expect(result.current.isError).toBe(true);
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
});
