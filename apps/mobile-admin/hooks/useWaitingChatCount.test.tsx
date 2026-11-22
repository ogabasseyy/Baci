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

    expect(result.current).toBe(3);
    expect(mocks.conversations).toHaveBeenCalledWith('needs_reply');
  });

  it('is zero while loading, on error and for an empty view', () => {
    mocks.conversations.mockReturnValue({ data: undefined });
    expect(renderHook(() => useWaitingChatCount()).result.current).toBe(0);

    mocks.conversations.mockReturnValue({ data: { pages: [] } });
    expect(renderHook(() => useWaitingChatCount()).result.current).toBe(0);

    mocks.conversations.mockReturnValue({
      data: { pages: [{ conversations: [] }] },
    });
    expect(renderHook(() => useWaitingChatCount()).result.current).toBe(0);
  });

  it('bugfix: relies on the server view, so a finished or answered chat is not counted', () => {
    // The server returns only live chats whose last message is the shopper's;
    // the count must not re-filter or widen it, whatever the rows look like.
    mocks.conversations.mockReturnValue({
      data: { pages: [{ conversations: [chat(1)] }] },
    });
    expect(renderHook(() => useWaitingChatCount()).result.current).toBe(1);
  });
});
