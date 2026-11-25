import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ conversations: vi.fn() }));

vi.mock('@/hooks/useInboxConversations', () => ({
  useInboxConversations: (view?: string) => mocks.conversations(view),
}));

import { useWaitingChatCount } from './useWaitingChatCount';

const chat = (id: number) => ({ id });

beforeEach(() => vi.clearAllMocks());

describe('useWaitingChatCount', () => {
  it('counts the chats in the Needs reply view, across pages', () => {
    mocks.conversations.mockReturnValue({
      data: {
        pages: [
          { conversations: [chat(1), chat(2)] },
          { conversations: [chat(3)] },
        ],
      },
    });

    const { result } = renderHook(() => useWaitingChatCount());

    expect(result.current).toEqual({ count: 3, hasMore: false });
    expect(mocks.conversations).toHaveBeenCalledWith('needs_reply');
  });

  it('is zero while loading, on error and for an empty view', () => {
    mocks.conversations.mockReturnValue({ data: undefined });
    expect(renderHook(() => useWaitingChatCount()).result.current.count).toBe(
      0
    );

    mocks.conversations.mockReturnValue({ data: { pages: [] } });
    expect(renderHook(() => useWaitingChatCount()).result.current.count).toBe(
      0
    );

    mocks.conversations.mockReturnValue({
      data: { pages: [{ conversations: [] }] },
    });
    expect(renderHook(() => useWaitingChatCount()).result.current.count).toBe(
      0
    );
  });

  it('bugfix: relies on the server view, so a finished or answered chat is not counted', () => {
    // The server returns only live chats whose last message is the shopper's;
    // the count must not re-filter or widen it, whatever the rows look like.
    mocks.conversations.mockReturnValue({
      data: { pages: [{ conversations: [chat(1)] }] },
    });
    expect(renderHook(() => useWaitingChatCount()).result.current.count).toBe(
      1
    );
  });

  it('bugfix: says the count may be higher while more pages are still to load', () => {
    mocks.conversations.mockReturnValue({
      data: { pages: [{ conversations: [chat(1), chat(2)] }] },
      fetchNextPage: vi.fn(),
      hasNextPage: true,
    });

    expect(renderHook(() => useWaitingChatCount()).result.current).toEqual({
      count: 2,
      hasMore: true,
    });
  });

  it('bugfix: counts a chat once when it shows up on two pages', () => {
    mocks.conversations.mockReturnValue({
      data: {
        pages: [
          { conversations: [chat(1), chat(2)] },
          { conversations: [chat(2)] },
        ],
      },
    });

    expect(renderHook(() => useWaitingChatCount()).result.current.count).toBe(
      2
    );
  });
});

/** A query with more pages behind the ones loaded. */
const morePages = (pages: number, state: Record<string, boolean> = {}) => {
  const fetchNextPage = vi.fn();
  mocks.conversations.mockReturnValue({
    data: {
      pages: Array.from({ length: pages }, () => ({ conversations: [] })),
    },
    fetchNextPage,
    hasNextPage: true,
    isError: false,
    isFetching: false,
    ...state,
  });
  renderHook(() => useWaitingChatCount());
  return fetchNextPage;
};

describe('useWaitingChatCount reaching an exact count', () => {
  it('bugfix: follows the pages to their end instead of stopping at the first', () => {
    // A non-empty page always reports more, even when nothing else is waiting.
    expect(morePages(1)).toHaveBeenCalledWith({ cancelRefetch: false });
  });

  it('stops after the same number of pages as the list', () => {
    expect(morePages(5)).not.toHaveBeenCalled();
  });

  it('waits for a running fetch and does not repeat a failed one', () => {
    expect(morePages(1, { isFetching: true })).not.toHaveBeenCalled();
    expect(morePages(1, { isError: true })).not.toHaveBeenCalled();
  });
});
