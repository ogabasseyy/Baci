import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getMerchantInboxConversation,
  listMerchantInboxConversations,
  listMerchantInboxMessages,
  sendMerchantInboxReply,
} from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';

const binding: MerchantInboxBinding = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  accountId: 2,
  inboxId: 20,
  apiAccessToken: 'synthetic-agent-token-aaaa',
  apiOrigin: 'https://chat.example.test',
};

const CREATED = 1_794_720_151;

function conversation(id: number, inboxId = 20) {
  return { id, inbox_id: inboxId, status: 'open', last_activity_at: CREATED };
}

function message(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: `message ${id}`,
    message_type: 0,
    created_at: CREATED,
    content_type: 'text',
    ...overrides,
  };
}

function stubFetch(
  handler: (
    url: URL,
    init?: RequestInit
  ) => { status?: number; body?: unknown } | Error
) {
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const result = handler(new URL(String(input)), init);
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

describe('listMerchantInboxConversations', () => {
  it('requests only the bound inbox with the server-side credential', async () => {
    const fetchMock = stubFetch(() => ({
      body: { data: { payload: [conversation(1), conversation(2, 99)] } },
    }));

    const result = await listMerchantInboxConversations(binding, {
      page: 2,
      status: 'open',
    });

    const [url, init] = fetchMock.mock.calls[0];
    const requested = new URL(String(url));
    expect(requested.origin).toBe('https://chat.example.test');
    expect(requested.pathname).toBe('/api/v1/accounts/2/conversations');
    expect(requested.searchParams.get('inbox_id')).toBe('20');
    expect(requested.searchParams.get('page')).toBe('2');
    expect(requested.searchParams.get('status')).toBe('open');
    expect((init?.headers as Record<string, string>).api_access_token).toBe(
      'synthetic-agent-token-aaaa'
    );
    // A row from another inbox is dropped even if the provider returns it.
    expect(result).toMatchObject({
      ok: true,
      hasMore: false,
      conversations: [{ id: 1 }],
    });
  });

  it.each([
    [1, 26, true],
    [1, 25, false],
    [2, 26, false],
  ])('page %i of %i conversations has more: %s (provider total)', async (page, total, expected) => {
    stubFetch(() => ({
      body: {
        data: {
          meta: { all_count: total },
          payload: Array.from({ length: 25 }, (_, i) => conversation(i + 1)),
        },
      },
    }));
    await expect(
      listMerchantInboxConversations(binding, { page, status: 'all' })
    ).resolves.toMatchObject({ ok: true, hasMore: expected });
  });

  it('falls back to a full page meaning more when no total is given', async () => {
    stubFetch(() => ({
      body: {
        data: {
          payload: Array.from({ length: 25 }, (_, i) => conversation(i + 1)),
        },
      },
    }));
    await expect(
      listMerchantInboxConversations(binding, { page: 1, status: 'all' })
    ).resolves.toMatchObject({ ok: true, hasMore: true });
  });

  it.each([
    ['a provider error', () => ({ status: 500 })],
    ['a network failure', () => new Error('offline')],
    ['an unexpected body', () => ({ body: { nope: true } })],
  ])('is unavailable on %s', async (_label, handler) => {
    stubFetch(handler);
    await expect(
      listMerchantInboxConversations(binding, { page: 1, status: 'all' })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('getMerchantInboxConversation', () => {
  it('treats a conversation from another inbox as not found', async () => {
    stubFetch(() => ({ body: conversation(7, 99) }));
    await expect(getMerchantInboxConversation(binding, 7)).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('maps a provider 404 to not found', async () => {
    stubFetch(() => ({ status: 404 }));
    await expect(getMerchantInboxConversation(binding, 7)).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
  });
});

describe('listMerchantInboxMessages', () => {
  it('never reads messages of a conversation outside the bound inbox', async () => {
    const fetchMock = stubFetch(() => ({ body: conversation(7, 99) }));

    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7 })
    ).resolves.toEqual({ ok: false, code: 'not_found' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns visible messages oldest first and pages with before', async () => {
    const fetchMock = stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: [
                message(31),
                message(30, { private: true }),
                message(29, { message_type: 1 }),
              ],
            },
          }
        : { body: conversation(7) }
    );

    const result = await listMerchantInboxMessages(binding, {
      conversationId: 7,
      before: 40,
    });

    expect(result).toMatchObject({
      ok: true,
      conversation: { id: 7 },
      messages: [
        { id: 29, sender: 'store' },
        { id: 31, sender: 'customer' },
      ],
    });
    const messagesUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(messagesUrl.pathname).toBe(
      '/api/v1/accounts/2/conversations/7/messages'
    );
    expect(messagesUrl.searchParams.get('before')).toBe('40');
  });

  it('is unavailable when the message read fails', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? { status: 502 }
        : { body: conversation(7) }
    );
    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7 })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('sendMerchantInboxReply', () => {
  const reply = { conversationId: 7, content: 'Yes, it is in stock.' };

  it('posts a public outgoing message into the bound conversation', async () => {
    const fetchMock = stubFetch((_url, init) =>
      init?.method === 'POST'
        ? { body: message(45, { message_type: 1, content: reply.content }) }
        : { body: conversation(7) }
    );

    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: true,
      message: {
        id: 45,
        sender: 'store',
        kind: 'text',
        text: 'Yes, it is in stock.',
        createdAt: new Date(CREATED * 1000).toISOString(),
      },
    });
    const [url, init] = fetchMock.mock.calls[1];
    expect(new URL(String(url)).pathname).toBe(
      '/api/v1/accounts/2/conversations/7/messages'
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      content: 'Yes, it is in stock.',
      message_type: 'outgoing',
      private: false,
    });
  });

  it('never posts into a conversation outside the bound inbox', async () => {
    const fetchMock = stubFetch(() => ({ body: conversation(7, 99) }));

    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['a network loss after submission', () => new Error('socket closed')],
    ['a provider 5xx', () => ({ status: 503 })],
    ['an unreadable accepted response', () => ({ body: { nope: true } })],
  ])('reports unknown delivery on %s without retrying', async (_l, post) => {
    const fetchMock = stubFetch((_url, init) =>
      init?.method === 'POST' ? post() : { body: conversation(7) }
    );

    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: false,
      code: 'delivery_unknown',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a definite provider rejection as unavailable', async () => {
    stubFetch((_url, init) =>
      init?.method === 'POST' ? { status: 422 } : { body: conversation(7) }
    );
    await expect(sendMerchantInboxReply(binding, reply)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});
