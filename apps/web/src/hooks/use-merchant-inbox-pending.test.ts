// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchMerchantInboxConversations: vi.fn(),
  fetchMerchantInboxThread: vi.fn(),
  sendMerchantInboxReply: vi.fn(),
}));
vi.mock('@/lib/merchant-inbox-api', () => api);

import { INBOX_THREAD_POLL_MS, useMerchantInbox } from './use-merchant-inbox';
import { message, resetInboxApi } from './use-merchant-inbox.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  resetInboxApi(api);
});

afterEach(() => vi.useRealTimers());

describe('useMerchantInbox pending replies', () => {
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

  it('keeps a just-sent reply when the poll already holds a newer customer message', async () => {
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

    api.fetchMerchantInboxThread.mockResolvedValue({
      ok: true,
      messages: [message(30), message(32)],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31, 32]);

    // Once the server returns it, it is shown once.
    api.fetchMerchantInboxThread.mockResolvedValue({
      ok: true,
      messages: [message(30), message(31, 'store'), message(32)],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_THREAD_POLL_MS);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30, 31, 32]);
  });

  it('stops showing an unconfirmed reply after a bounded time', async () => {
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(result.current.messages.map((m) => m.id)).toEqual([30]);
  });

  it('keeps a pending reply when the merchant opens another chat and comes back', async () => {
    api.fetchMerchantInboxThread.mockImplementation((id: number) =>
      Promise.resolve({ ok: true, messages: [message(id === 7 ? 30 : 80)] })
    );
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));
    await act(async () => {
      await result.current.sendReply('In stock');
    });

    act(() => result.current.selectConversation(8));
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([80])
    );
    act(() => result.current.selectConversation(7));
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([30, 31])
    );
  });
});
