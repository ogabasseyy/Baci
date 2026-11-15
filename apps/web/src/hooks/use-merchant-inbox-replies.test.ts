// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchMerchantInboxConversations: vi.fn(),
  fetchMerchantInboxThread: vi.fn(),
  sendMerchantInboxReply: vi.fn(),
}));
vi.mock('@/lib/merchant-inbox-api', () => api);

import { useMerchantInbox } from './use-merchant-inbox';
import { message, resetInboxApi } from './use-merchant-inbox.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  resetInboxApi(api);
});

afterEach(() => vi.useRealTimers());

describe('useMerchantInbox replies', () => {
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

  it('clears a reply error in the same update that opens another conversation', async () => {
    api.sendMerchantInboxReply.mockResolvedValue({
      ok: false,
      code: 'delivery_unknown',
    });
    const { result } = renderHook(() => useMerchantInbox());
    await waitFor(() => expect(result.current.listState).toBe('ready'));
    act(() => result.current.selectConversation(7));
    await waitFor(() => expect(result.current.threadState).toBe('ready'));
    await act(async () => {
      await result.current.sendReply('hello');
    });
    expect(result.current.sendError).toBe('delivery_unknown');

    const seen: unknown[] = [];
    act(() => result.current.selectConversation(8));
    seen.push(result.current.sendError);
    expect(seen).toEqual([null]);
    expect(result.current.selectedId).toBe(8);
  });
});
