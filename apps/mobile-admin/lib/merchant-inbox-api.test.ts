import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from './api-errors';

const apiClient = vi.hoisted(() => vi.fn());
vi.mock('./api-client', async () => {
  const errors = await import('./api-errors');
  return { apiClient, NetworkError: errors.NetworkError };
});

import {
  fetchInboxConversations,
  fetchInboxThread,
  isDefinitelyNotSent,
  sendInboxReply,
} from './merchant-inbox-api';

const message = {
  id: 7,
  sender: 'store',
  kind: 'text',
  text: 'Yes, in stock',
  createdAt: '2026-11-22T10:00:00Z',
};

describe('merchant inbox api', () => {
  beforeEach(() => apiClient.mockReset());

  it('requests the requested conversations page', async () => {
    apiClient.mockResolvedValue({ conversations: [], hasMore: false, page: 2 });
    await fetchInboxConversations(2);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations?page=2'
    );
  });

  it('rejects a malformed thread response', async () => {
    apiClient.mockResolvedValue({ messages: 'nope' });
    await expect(fetchInboxThread(5)).rejects.toThrow();
  });

  it('pages older messages with before', async () => {
    apiClient.mockResolvedValue({
      conversation: {
        id: 5,
        status: 'open',
        unreadCount: 0,
        customerName: 'Ada',
        lastActivityAt: null,
        lastMessage: null,
      },
      messages: [],
    });
    await fetchInboxThread(5, 99);
    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations/5/messages?before=99'
    );
  });

  it('posts the reply content as JSON', async () => {
    apiClient.mockResolvedValue({ message });
    await expect(sendInboxReply(5, 'Yes, in stock')).resolves.toMatchObject({
      id: 7,
    });
    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations/5/messages',
      { method: 'POST', body: JSON.stringify({ content: 'Yes, in stock' }) }
    );
  });

  it('treats only 4xx answers as definitely not sent', () => {
    expect(
      isDefinitelyNotSent(new NetworkError('x', { statusCode: 403 }))
    ).toBe(true);
    expect(
      isDefinitelyNotSent(new NetworkError('x', { statusCode: 502 }))
    ).toBe(false);
    expect(
      isDefinitelyNotSent(new NetworkError('x', { isTimeout: true }))
    ).toBe(false);
    expect(isDefinitelyNotSent(new Error('boom'))).toBe(false);
  });
});
