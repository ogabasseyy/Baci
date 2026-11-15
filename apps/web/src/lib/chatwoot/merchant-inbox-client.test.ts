import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getMerchantInboxConversation,
  listMerchantInboxConversations,
  listMerchantInboxMessages,
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
  handler: (url: URL) => { status?: number; body?: unknown } | Error
) {
  const fetchMock = vi.fn(async (input: URL | string, _init?: RequestInit) => {
    const result = handler(new URL(String(input)));
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
      conversations: [{ id: 1 }],
    });
  });

  it.each([
    // [page, rows on this provider page, provider total, expected]
    [1, 25, 26, true],
    [1, 25, 25, false],
    [1, 10, 30, true], // a provider configured for 10 per page
    [3, 10, 30, false],
    [2, 0, 25, false], // an empty page always ends paging
    [1, 21, 21, false],
  ])('page %i with %i rows of %i total has more: %s', async (page, rows, total, expected) => {
    stubFetch(() => ({
      body: {
        data: {
          meta: { all_count: total },
          payload: Array.from({ length: rows }, (_, i) => conversation(i + 1)),
        },
      },
    }));
    await expect(
      listMerchantInboxConversations(binding, { page, status: 'all' })
    ).resolves.toMatchObject({ ok: true, hasMore: expected });
  });

  it.each([
    [25, true],
    [10, true],
    [0, false],
  ])('without a provider total, %i rows has more: %s', async (rows, expected) => {
    stubFetch(() => ({
      body: {
        data: {
          payload: Array.from({ length: rows }, (_, i) => conversation(i + 1)),
        },
      },
    }));
    await expect(
      listMerchantInboxConversations(binding, { page: 1, status: 'all' })
    ).resolves.toMatchObject({ ok: true, hasMore: expected });
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
      hasOlder: true,
      nextBefore: 29,
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

  it('signals an older page with a cursor that counts hidden rows', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? {
            body: {
              payload: [
                message(100, { private: true }),
                ...Array.from({ length: 19 }, (_, i) => message(101 + i)),
              ],
            },
          }
        : { body: conversation(7) }
    );
    const result = await listMerchantInboxMessages(binding, {
      conversationId: 7,
    });
    expect(result).toMatchObject({ ok: true, hasOlder: true, nextBefore: 100 });
    if (result.ok) expect(result.messages).toHaveLength(19);
  });

  it('ends paging on an empty page', async () => {
    stubFetch((url) =>
      url.pathname.endsWith('/messages')
        ? { body: { payload: [] } }
        : { body: conversation(7) }
    );
    await expect(
      listMerchantInboxMessages(binding, { conversationId: 7, before: 29 })
    ).resolves.toMatchObject({
      ok: true,
      messages: [],
      hasOlder: false,
      nextBefore: null,
    });
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
