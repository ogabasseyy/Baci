import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from '@/lib/api-errors';
import { inboxConversationsKey } from '@/lib/inbox-query-keys';
import type { InboxMessage } from '@/schemas/merchant-inbox';

const apiClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { apiClient, NetworkError: errors.NetworkError };
});
const sendInboxReply = apiClient;

import { useInboxReply } from './useInboxReply';

const sent: InboxMessage = {
  id: 10,
  sender: 'store',
  kind: 'text',
  text: 'Hello',
  createdAt: '2026-11-22T10:00:00Z',
};

function setup(refreshThread = vi.fn(async (): Promise<InboxMessage[]> => [])) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useInboxReply({ conversationId: 5, merchantId: 'm1', refreshThread }),
    { wrapper }
  );
  return { ...hook, client, refreshThread };
}

describe('useInboxReply', () => {
  beforeEach(() => sendInboxReply.mockReset());

  it('clears the draft and invalidates conversations after a successful send', async () => {
    apiClient.mockResolvedValue({ message: sent });
    const { client, result } = setup();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    act(() => result.current.setDraft('  Hello '));
    await act(() => result.current.send(3));
    expect(sendInboxReply).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations/5/messages',
      { method: 'POST', body: JSON.stringify({ content: 'Hello' }) }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: inboxConversationsKey('m1'),
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.draft).toBe('');
  });

  it('keeps the draft and allows a retry after the server refuses it', async () => {
    sendInboxReply.mockRejectedValueOnce(
      new NetworkError('no', { statusCode: 403 })
    );
    const { result } = setup();
    act(() => result.current.setDraft('Hello'));
    await act(() => result.current.send(3));
    expect(result.current.status).toBe('failed');
    expect(result.current.draft).toBe('Hello');

    apiClient.mockResolvedValueOnce({ message: sent });
    await act(() => result.current.send(3));
    expect(sendInboxReply).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('idle');
  });

  it('does not send twice after a timeout when the first send arrived', async () => {
    sendInboxReply.mockRejectedValueOnce(
      new NetworkError('slow', { isTimeout: true })
    );
    const { result, refreshThread } = setup(
      vi.fn(async () => [{ ...sent, id: 11 }])
    );
    act(() => result.current.setDraft('Hello'));
    await act(() => result.current.send(3));
    expect(result.current.status).toBe('unconfirmed');

    await act(() => result.current.send(3));
    expect(refreshThread).toHaveBeenCalledTimes(1);
    expect(sendInboxReply).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.draft).toBe('');
  });

  it('resends after a timeout only when the thread shows it never arrived', async () => {
    sendInboxReply.mockRejectedValueOnce(
      new NetworkError('slow', { isTimeout: true })
    );
    const { result } = setup(vi.fn(async () => []));
    act(() => result.current.setDraft('Hello'));
    await act(() => result.current.send(3));

    apiClient.mockResolvedValueOnce({ message: sent });
    await act(() => result.current.send(3));
    expect(sendInboxReply).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('idle');
  });

  it('resets unconfirmed status when the merchant edits the draft', async () => {
    sendInboxReply.mockRejectedValueOnce(
      new NetworkError('slow', { isTimeout: true })
    );
    const { result, refreshThread } = setup(
      vi.fn(async () => [{ ...sent, id: 11, text: 'Hello!' }])
    );
    act(() => result.current.setDraft('Hello'));
    await act(() => result.current.send(3));
    expect(result.current.status).toBe('unconfirmed');

    act(() => result.current.setDraft('Hello!'));
    expect(result.current.status).toBe('idle');

    apiClient.mockResolvedValueOnce({
      message: { ...sent, id: 12, text: 'Hello!' },
    });
    await act(() => result.current.send(3));
    expect(refreshThread).not.toHaveBeenCalled();
    expect(sendInboxReply).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('idle');
  });

  it('ignores a second tap while a send is in flight', async () => {
    let resolve: (m: InboxMessage) => void = () => {};
    sendInboxReply.mockReturnValue(
      new Promise<InboxMessage>((r) => (resolve = r))
    );
    const { result } = setup();
    act(() => result.current.setDraft('Hello'));
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.send(3);
    });
    expect(result.current.status).toBe('sending');
    expect(result.current.canSend).toBe(false);
    await act(() => result.current.send(3));
    expect(sendInboxReply).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(sent);
      await first;
    });
  });
});
