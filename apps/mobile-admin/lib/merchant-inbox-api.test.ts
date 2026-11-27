import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkError } from './api-errors';

const apiClient = vi.hoisted(() => vi.fn());
vi.mock('./api-client', async () => {
  const errors = await import('./api-errors');
  return { apiClient, NetworkError: errors.NetworkError };
});

import {
  fetchInboxConversations,
  fetchInboxCustomer,
  fetchInboxThread,
  isDefinitelyNotSent,
  searchInbox,
  sendInboxReply,
  updateInboxConversation,
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
      '/api/merchant/inbox/conversations?page=2&view=all'
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

  it('names the store a reply was meant for, only when asked to', async () => {
    apiClient.mockResolvedValue({ message });

    await sendInboxReply(5, 'Hi', '11111111-1111-4111-8111-111111111111');

    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations/5/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          content: 'Hi',
          merchantId: '11111111-1111-4111-8111-111111111111',
        }),
      }
    );
  });

  it('treats only 4xx answers as definitely not sent', () => {
    expect(
      isDefinitelyNotSent(new NetworkError('x', { statusCode: 403 }))
    ).toBe(true);
    expect(
      isDefinitelyNotSent(new NetworkError('x', { statusCode: 408 }))
    ).toBe(false);
    expect(
      isDefinitelyNotSent(new NetworkError('x', { statusCode: 502 }))
    ).toBe(false);
    expect(
      isDefinitelyNotSent(new NetworkError('x', { isTimeout: true }))
    ).toBe(false);
    expect(isDefinitelyNotSent(new Error('boom'))).toBe(false);
  });
});

describe('business tools', () => {
  it('asks for one view of the list', async () => {
    apiClient.mockResolvedValue({ conversations: [], hasMore: false, page: 1 });
    await fetchInboxConversations(2, 'follow_up');
    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations?page=2&view=follow_up'
    );
  });

  it('patches one chat with only the changes asked for', async () => {
    apiClient.mockResolvedValue({
      conversation: {
        id: 7,
        status: 'resolved',
        unreadCount: 0,
        customerName: 'Ada',
        lastActivityAt: null,
        lastMessage: null,
      },
    });
    const result = await updateInboxConversation(7, { status: 'resolved' });
    expect(result.status).toBe('resolved');
    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations/7',
      { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }
    );
  });

  it('encodes the search term', async () => {
    apiClient.mockResolvedValue({ results: [], hasMore: false, page: 1 });
    await searchInbox('order #12 & more');
    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations/search?q=order%20%2312%20%26%20more&page=1'
    );
  });
});

describe('customer context', () => {
  it('reads the customer behind a chat', async () => {
    apiClient.mockResolvedValue({
      customer: {
        name: 'Ada Obi',
        currency: 'NGN',
        memberSince: null,
        orderCount: 2,
        totalSpent: 100,
        loyaltyPoints: 0,
        recentOrders: [],
      },
    });
    const customer = await fetchInboxCustomer(7);
    expect(customer?.name).toBe('Ada Obi');
    expect(apiClient).toHaveBeenCalledWith(
      '/api/merchant/inbox/conversations/7/customer'
    );
  });

  it('returns null for a guest chat', async () => {
    apiClient.mockResolvedValue({ customer: null });
    await expect(fetchInboxCustomer(7)).resolves.toBeNull();
  });

  it('rejects a malformed customer answer', async () => {
    apiClient.mockResolvedValue({ customer: { name: 5 } });
    await expect(fetchInboxCustomer(7)).rejects.toThrow();
  });
});
