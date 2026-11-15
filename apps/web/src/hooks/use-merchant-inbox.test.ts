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

function message(id: number, sender = 'customer') {
  return {
    id,
    sender,
    kind: 'text',
    text: `message ${id}`,
    createdAt: '2026-11-15T06:00:00.000Z',
  };
}
function conversation(id: number) {
  return {
    id,
    status: 'open',
    unreadCount: 0,
    customerName: `Customer ${id}`,
    lastActivityAt: null,
    lastMessage: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchMerchantInboxConversations.mockResolvedValue({
    ok: true,
    conversations: [conversation(7), conversation(8)],
    hasMore: false,
  });
  api.fetchMerchantInboxThread.mockResolvedValue({
    ok: true,
    messages: [message(30)],
  });
  api.sendMerchantInboxReply.mockResolvedValue({
    ok: true,
    message: message(31, 'store'),
  });
});

afterEach(() => vi.useRealTimers());

describe('useMerchantInbox', () => {
  it('loads conversations, then a selected thread', async () => {
    const { result } = renderHook(() => useMerchantInbox());
    expect(result.current.listState).toBe('loading');
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    expect(result.current.conversations).toHaveLength(2);
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

  it('appends an accepted reply and reports success', async () => {
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));

    let accepted = false;
    await act(async () => {
      accepted = await result.current.sendReply('  In stock  ');
    });
    expect(accepted).toBe(true);
    expect(api.sendMerchantInboxReply).toHaveBeenCalledWith(7, 'In stock');
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31]);
    expect(result.current.sendError).toBeNull();
  });

  it('keeps the thread and exposes the error when a reply fails', async () => {
    api.sendMerchantInboxReply.mockResolvedValue({
      ok: false,
      code: 'delivery_unknown',
    });
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.sendReply('In stock');
    });
    expect(accepted).toBe(false);
    expect(result.current.sendError).toBe('delivery_unknown');
    expect(result.current.messages).toEqual([message(30)]);
  });

  it('does not send without a selection or with blank text', async () => {
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    await act(async () => {
      await result.current.sendReply('hello');
    });
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));
    await act(async () => {
      await result.current.sendReply('   ');
    });
    expect(api.sendMerchantInboxReply).not.toHaveBeenCalled();
  });

  it('sends once when submit fires twice before the first render', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.sendMerchantInboxReply.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));

    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = result.current.sendReply('In stock');
      second = result.current.sendReply('In stock');
    });
    await expect(second).resolves.toBe(false);
    await act(async () => {
      release({ ok: true, message: message(31, 'store') });
      await first;
    });
    expect(api.sendMerchantInboxReply).toHaveBeenCalledOnce();
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31]);
  });

  it('never shows a reply or its error in a conversation opened meanwhile', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.sendMerchantInboxReply.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    api.fetchMerchantInboxThread.mockImplementation((id: number) =>
      Promise.resolve({ ok: true, messages: [message(id === 7 ? 30 : 80)] })
    );
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));

    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.sendReply('For conversation seven');
    });
    act(() => result.current.selectConversation(8));
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([80])
    );
    await act(async () => {
      release({ ok: true, message: message(31, 'store') });
      await pending;
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([80]);

    act(() => {
      pending = result.current.sendReply('For conversation eight');
    });
    act(() => result.current.selectConversation(7));
    await act(async () => {
      release({ ok: false, code: 'delivery_unknown' });
      await pending;
    });
    expect(result.current.sendError).toBeNull();
  });

  it('keeps a just-sent reply when the next poll does not include it yet', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMerchantInbox());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.selectConversation(7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await result.current.sendReply('In stock');
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31]);

    api.fetchMerchantInboxThread.mockResolvedValue({
      ok: true,
      messages: [message(30), message(31, 'store'), message(32)],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31, 32]);
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

  it('ignores an older poll that resolves after a newer one', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMerchantInbox());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.selectConversation(7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    let releaseSlow: (value: unknown) => void = () => undefined;
    api.fetchMerchantInboxThread
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSlow = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        messages: [message(30), message(33)],
      });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 33]);

    await act(async () => {
      releaseSlow({ ok: true, messages: [message(30)] });
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 33]);
  });

  it('shows sending only in the conversation whose reply is in flight', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.sendMerchantInboxReply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));

    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.sendReply('For seven');
    });
    expect(result.current.sending).toBe(true);

    act(() => result.current.selectConversation(8));
    expect(result.current.sending).toBe(false);
    await waitFor(() => expect(result.current.threadState).toBe('ready'));
    let other = false;
    await act(async () => {
      other = await result.current.sendReply('For eight');
    });
    expect(other).toBe(true);
    expect(api.sendMerchantInboxReply).toHaveBeenLastCalledWith(8, 'For eight');

    await act(async () => {
      release({ ok: true, message: message(31, 'store') });
      await pending;
    });
  });
});
