// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchMerchantInboxConversations: vi.fn(),
  fetchMerchantInboxThread: vi.fn(),
  sendMerchantInboxReply: vi.fn(),
}));
vi.mock('@/lib/merchant-inbox-api', () => api);

import {
  INBOX_LIST_POLL_MS,
  INBOX_THREAD_POLL_MS,
  useMerchantInbox,
} from './use-merchant-inbox';
import {
  conversation,
  message,
  resetInboxApi,
} from './use-merchant-inbox.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  resetInboxApi(api);
});

afterEach(() => vi.useRealTimers());

describe('useMerchantInbox list and thread polling', () => {
  it('loads conversations, then a selected thread', async () => {
    const { result } = renderHook(() => useMerchantInbox());
    expect(result.current.listState).toBe('loading');
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    expect(result.current.conversations).toHaveLength(2);
    expect(result.current.hasMoreConversations).toBe(false);
    expect(result.current.threadState).toBe('idle');

    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));
    expect(api.fetchMerchantInboxThread).toHaveBeenCalledWith(7);
    expect(result.current.messages).toEqual([message(30)]);
    expect(result.current.selectedConversation?.customerName).toBe(
      'Customer 7'
    );
  });

  it.each([
    ['inbox_unavailable', 'not_set_up'],
    ['forbidden', 'forbidden'],
    ['unauthorized', 'signed_out'],
    ['not_found', 'not_set_up'],
    ['temporarily_unavailable', 'unavailable'],
  ])('shows %s as %s on first load', async (code, state) => {
    api.fetchMerchantInboxConversations.mockResolvedValue({ ok: false, code });
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe(state));
  });

  it('polls and keeps the list through a transient failure', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMerchantInbox());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.listState).toBe('ready');

    api.fetchMerchantInboxConversations.mockResolvedValue({
      ok: false,
      code: 'temporarily_unavailable',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_LIST_POLL_MS);
    });
    expect(api.fetchMerchantInboxConversations).toHaveBeenCalledTimes(2);
    expect(result.current.listState).toBe('ready');
    expect(result.current.conversations).toHaveLength(2);
  });

  it('polls the open thread for new messages', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMerchantInbox());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.selectConversation(7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    api.fetchMerchantInboxThread.mockResolvedValue({
      ok: true,
      messages: [message(30), message(32)],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 32]);
  });

  it('ignores a slow thread response after switching conversations', async () => {
    let releaseFirst: (value: unknown) => void = () => undefined;
    api.fetchMerchantInboxThread.mockImplementation((id: number) =>
      id === 7
        ? new Promise((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve({ ok: true, messages: [message(80)] })
    );
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));

    act(() => result.current.selectConversation(7));
    act(() => result.current.selectConversation(8));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));
    await act(async () => {
      releaseFirst({ ok: true, messages: [message(30)] });
    });
    expect(result.current.messages).toEqual([message(80)]);
  });

  it('refreshes at once when the tab becomes visible again', async () => {
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));
    const lists = api.fetchMerchantInboxConversations.mock.calls.length;
    const threads = api.fetchMerchantInboxThread.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(api.fetchMerchantInboxConversations).toHaveBeenCalledTimes(
      lists + 1
    );
    expect(api.fetchMerchantInboxThread).toHaveBeenCalledTimes(threads + 1);
  });

  it('applies a thread response that is slower than the poll interval', async () => {
    vi.useFakeTimers();
    const slow = INBOX_THREAD_POLL_MS * 2 + 500;
    let calls = 0;
    api.fetchMerchantInboxThread.mockImplementation(() => {
      calls += 1;
      const batch = calls === 1 ? [message(30)] : [message(30), message(40)];
      return new Promise((resolve) => {
        setTimeout(() => resolve({ ok: true, messages: batch }), slow);
      });
    });
    const { result } = renderHook(() => useMerchantInbox());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.selectConversation(7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.threadState).toBe('loading');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(slow);
    });
    expect(result.current.threadState).toBe('ready');
    expect(result.current.messages.map((m) => m.id)).toEqual([30]);
    // Ticks that fired while the first request ran were skipped, not stacked.
    expect(api.fetchMerchantInboxThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS + slow);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 40]);
  });

  it('applies a list response that is slower than the poll interval', async () => {
    vi.useFakeTimers();
    const slow = INBOX_LIST_POLL_MS * 2 + 500;
    api.fetchMerchantInboxConversations.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                conversations: [conversation(7)],
                hasMore: false,
              }),
            slow
          );
        })
    );
    const { result } = renderHook(() => useMerchantInbox());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(slow);
    });
    expect(result.current.listState).toBe('ready');
    expect(api.fetchMerchantInboxConversations).toHaveBeenCalledTimes(1);
  });
});
