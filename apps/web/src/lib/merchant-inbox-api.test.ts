import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: (headers: Record<string, string>) => ({
    ...headers,
    'x-csrf-token': 'csrf-token',
  }),
}));

import {
  fetchMerchantInboxConversations,
  fetchMerchantInboxThread,
  sendMerchantInboxReply,
} from './merchant-inbox-api';

const message = {
  id: 30,
  sender: 'customer',
  kind: 'text',
  text: 'Hello',
  createdAt: '2026-11-15T06:00:00.000Z',
};
const conversation = {
  id: 7,
  status: 'open',
  unreadCount: 1,
  customerName: 'Synthetic Visitor',
  lastActivityAt: '2026-11-15T06:00:00.000Z',
  lastMessage: message,
};

function stubFetch(result: { status?: number; body?: unknown } | Error) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (result instanceof Error) throw result;
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchMerchantInboxConversations', () => {
  it('returns validated conversations', async () => {
    const fetchMock = stubFetch({
      body: { conversations: [conversation], hasMore: false, page: 1 },
    });
    await expect(fetchMerchantInboxConversations()).resolves.toEqual({
      ok: true,
      conversations: [conversation],
      hasMore: false,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/merchant/inbox/conversations'
    );
  });

  it.each([
    [404, 'inbox_unavailable', 'inbox_unavailable'],
    [403, 'forbidden', 'forbidden'],
    [503, 'temporarily_unavailable', 'temporarily_unavailable'],
    [500, 'something_new', 'temporarily_unavailable'],
  ])('maps a %i %s response', async (status, code, expected) => {
    stubFetch({ status, body: { code } });
    await expect(fetchMerchantInboxConversations()).resolves.toEqual({
      ok: false,
      code: expected,
    });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'temporarily_unavailable'],
  ])('classifies a %i with no readable code by status', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => {
          throw new Error('not json');
        },
      }))
    );
    await expect(fetchMerchantInboxConversations()).resolves.toEqual({
      ok: false,
      code,
    });
  });

  it('treats a malformed success body as unavailable', async () => {
    stubFetch({ body: { conversations: [{ id: 'x' }] } });
    await expect(fetchMerchantInboxConversations()).resolves.toEqual({
      ok: false,
      code: 'temporarily_unavailable',
    });
  });

  it('treats a network failure as unavailable', async () => {
    stubFetch(new Error('offline'));
    await expect(fetchMerchantInboxConversations()).resolves.toEqual({
      ok: false,
      code: 'temporarily_unavailable',
    });
  });
});

describe('fetchMerchantInboxThread', () => {
  it('requests the conversation thread', async () => {
    const fetchMock = stubFetch({
      body: { conversation, messages: [message] },
    });
    await expect(fetchMerchantInboxThread(7)).resolves.toEqual({
      ok: true,
      messages: [message],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/merchant/inbox/conversations/7/messages'
    );
  });
});

describe('sendMerchantInboxReply', () => {
  it('posts the reply with the CSRF header', async () => {
    const sent = { ...message, id: 31, sender: 'store', text: 'In stock' };
    const fetchMock = stubFetch({ body: { message: sent } });

    await expect(sendMerchantInboxReply(7, 'In stock')).resolves.toEqual({
      ok: true,
      message: sent,
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-csrf-token': 'csrf-token',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ content: 'In stock' });
  });

  it('reports unknown delivery when the request is lost', async () => {
    stubFetch(new Error('connection reset'));
    await expect(sendMerchantInboxReply(7, 'In stock')).resolves.toEqual({
      ok: false,
      code: 'delivery_unknown',
    });
  });

  it('reports unknown delivery for an unreadable success body', async () => {
    stubFetch({ body: { nope: true } });
    await expect(sendMerchantInboxReply(7, 'In stock')).resolves.toEqual({
      ok: false,
      code: 'delivery_unknown',
    });
  });

  it('passes through the server delivery_unknown code', async () => {
    stubFetch({ status: 502, body: { code: 'delivery_unknown' } });
    await expect(sendMerchantInboxReply(7, 'In stock')).resolves.toEqual({
      ok: false,
      code: 'delivery_unknown',
    });
  });
  it.each([
    [502, 'bare gateway 502'],
    [504, 'bare gateway 504'],
    [401, 'bare 401'],
  ])('reports unknown delivery for a %i with no readable code (%s)', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => {
          throw new Error('<html>Bad gateway</html>');
        },
      }))
    );
    await expect(sendMerchantInboxReply(7, 'In stock')).resolves.toEqual({
      ok: false,
      code: 'delivery_unknown',
    });
  });

  it('treats an unrecognised code on a read as a retryable outage', async () => {
    stubFetch({ status: 502, body: { code: 'upstream_timeout' } });
    await expect(fetchMerchantInboxConversations()).resolves.toEqual({
      ok: false,
      code: 'temporarily_unavailable',
    });
  });

  it('reports unknown delivery for an unrecognised code from a proxy', async () => {
    stubFetch({ status: 502, body: { code: 'upstream_timeout' } });
    await expect(sendMerchantInboxReply(7, 'In stock')).resolves.toEqual({
      ok: false,
      code: 'delivery_unknown',
    });
  });

  it.each([
    [403, 'forbidden', 'forbidden'],
    [401, 'unauthorized', 'unauthorized'],
    [404, 'not_found', 'not_found'],
    [503, 'temporarily_unavailable', 'temporarily_unavailable'],
  ])('keeps the definite %i %s rejection', async (status, code, expected) => {
    stubFetch({ status, body: { code } });
    await expect(sendMerchantInboxReply(7, 'In stock')).resolves.toEqual({
      ok: false,
      code: expected,
    });
  });
});
