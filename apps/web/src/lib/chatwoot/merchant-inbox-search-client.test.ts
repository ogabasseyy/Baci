import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  binding,
  conversation,
  stubFetch,
} from './merchant-inbox-client.test-support';
import { searchMerchantInboxConversations } from './merchant-inbox-search-client';

afterEach(() => vi.unstubAllGlobals());

/** Row of `/search/conversations` as Chatwoot v4.19.1 renders it. */
const contactRow = (id: number, inboxId: number, name = 'Ada') => ({
  id,
  account_id: 2,
  created_at: 1_794_720_151,
  message: {},
  contact: { id: 5, name },
  inbox: { id: inboxId, name: 'Web', channel_type: 'Channel::WebWidget' },
  agent: {},
  additional_attributes: {},
});

/** Row of `/conversations/search` (models/_conversation partial). */
const messageRow = (
  id: number,
  inboxId: number,
  messages: Array<{ content: string; message_type: number }> = []
) => ({
  id,
  uuid: `uuid-${id}`,
  created_at: 1_794_720_151,
  contact: { id: 5, name: 'Ada' },
  inbox: { id: inboxId, name: 'Web', channel_type: 'Channel::WebWidget' },
  messages: messages.map((m, i) => ({ id: i + 1, ...m, created_at: 1 })),
  account_id: 2,
});

type Routes = {
  contact?: unknown;
  message?: unknown;
  contactStatus?: number;
  messageStatus?: number;
  /** Full conversation reads, by id. */
  reads?: Record<number, unknown>;
};

function stub(routes: Routes) {
  const calls: URL[] = [];
  const fetchMock = stubFetch((url) => {
    calls.push(url);
    const path = url.pathname.replace('/api/v1/accounts/2', '');
    if (path === '/search/conversations') {
      return routes.contactStatus
        ? { status: routes.contactStatus }
        : { body: routes.contact ?? { payload: { conversations: [] } } };
    }
    if (path === '/conversations/search') {
      return routes.messageStatus
        ? { status: routes.messageStatus }
        : { body: routes.message ?? { meta: {}, payload: [] } };
    }
    const id = Number(path.split('/')[2]);
    const read = routes.reads?.[id];
    return read ? { body: read } : { status: 404 };
  });
  return { calls, fetchMock };
}

const named = (id: number, name: string, inboxId = 20) => ({
  ...conversation(id, inboxId),
  meta: { sender: { name } },
});

describe('searchMerchantInboxConversations', () => {
  it('finds a chat by name through the contact search, reading it in full', async () => {
    const { calls } = stub({
      contact: { payload: { conversations: [contactRow(1, 20)] } },
      reads: { 1: named(1, 'Ada') },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'ada',
      page: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      hasMore: true,
      results: [
        { conversation: { id: 1, customerName: 'Ada' }, snippet: null },
      ],
    });
    const contactCall = calls.find((u) =>
      u.pathname.endsWith('/search/conversations')
    );
    expect(contactCall?.searchParams.get('q')).toBe('ada');
  });

  it('finds a chat by what the shopper wrote, limited to the bound inbox', async () => {
    const { calls } = stub({
      message: {
        meta: {},
        payload: [
          messageRow(2, 20, [
            { content: 'Where is my order?', message_type: 0 },
          ]),
        ],
      },
      reads: { 2: named(2, 'Bo') },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'order',
      page: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      results: [{ conversation: { id: 2 }, snippet: 'Where is my order?' }],
    });
    const messageCall = calls.find((u) =>
      u.pathname.endsWith('/conversations/search')
    );
    expect(messageCall?.searchParams.get('inbox_id')).toBe('20');
    expect(messageCall?.searchParams.get('page')).toBe('2');
  });

  it('bugfix: reads the provider-specific row shape instead of dropping every row', async () => {
    // These rows have no top-level inbox_id or status: the list parser would
    // reject all of them. Search must still return them.
    stub({
      contact: { payload: { conversations: [contactRow(3, 20)] } },
      message: { meta: {}, payload: [messageRow(4, 20)] },
      reads: { 3: named(3, 'Cy'), 4: named(4, 'Di') },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'x',
      page: 1,
    });

    expect(
      result.ok && result.results.map((r) => r.conversation.id).sort()
    ).toEqual([3, 4]);
  });

  it('drops other stores chats without reading them', async () => {
    const { calls } = stub({
      contact: {
        payload: { conversations: [contactRow(1, 20), contactRow(9, 99)] },
      },
      reads: { 1: named(1, 'Ada'), 9: named(9, 'Other', 99) },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'a',
      page: 1,
    });

    expect(result.ok && result.results.map((r) => r.conversation.id)).toEqual([
      1,
    ]);
    expect(calls.some((u) => u.pathname.endsWith('/conversations/9'))).toBe(
      false
    );
  });

  it('refuses a chat whose full read says it is in another inbox', async () => {
    stub({
      contact: { payload: { conversations: [contactRow(5, 20)] } },
      // A row claiming the bound inbox but a read that disagrees.
      reads: { 5: named(5, 'Sneaky', 99) },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'a',
      page: 1,
    });

    expect(result).toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('merges both searches, shows a chat once and keeps the shopper snippet', async () => {
    const { calls } = stub({
      contact: { payload: { conversations: [contactRow(1, 20)] } },
      message: {
        meta: {},
        payload: [
          messageRow(1, 20, [{ content: 'Is it in stock', message_type: 0 }]),
        ],
      },
      reads: { 1: named(1, 'Ada') },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'stock',
      page: 1,
    });

    expect(result).toMatchObject({
      results: [{ conversation: { id: 1 }, snippet: 'Is it in stock' }],
    });
    // One full read, not two.
    expect(
      calls.filter((u) => u.pathname.endsWith('/conversations/1'))
    ).toHaveLength(1);
  });

  it('never quotes staff messages: private notes look like public replies in search', async () => {
    stub({
      message: {
        meta: {},
        payload: [
          messageRow(6, 20, [
            { content: 'internal: customer is a fraud risk', message_type: 1 },
          ]),
        ],
      },
      reads: { 6: named(6, 'Ed') },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'fraud',
      page: 1,
    });

    expect(result.ok && result.results[0].snippet).toBeNull();
  });

  it('works when one search fails and the other answers', async () => {
    stub({
      contactStatus: 500,
      message: { meta: {}, payload: [messageRow(7, 20)] },
      reads: { 7: named(7, 'Flo') },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'a',
      page: 1,
    });

    expect(result.ok && result.results).toHaveLength(1);
  });

  it('reports unavailable when both searches fail', async () => {
    stub({ contactStatus: 502, messageStatus: 502 });
    await expect(
      searchMerchantInboxConversations(binding, { q: 'a', page: 1 })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });

  it('keeps paging when a page held only other stores chats', async () => {
    stub({
      contact: { payload: { conversations: [contactRow(9, 99)] } },
    });
    await expect(
      searchMerchantInboxConversations(binding, { q: 'a', page: 1 })
    ).resolves.toEqual({ ok: true, results: [], hasMore: true });
  });

  it('stops paging on empty provider pages', async () => {
    stub({});
    await expect(
      searchMerchantInboxConversations(binding, { q: 'zz', page: 9 })
    ).resolves.toEqual({ ok: true, results: [], hasMore: false });
  });

  it('shows the newest chat first and reads at most twenty matches', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => contactRow(i + 1, 20));
    const reads: Record<number, unknown> = {};
    for (let i = 1; i <= 30; i++) {
      reads[i] = {
        ...named(i, `Shopper ${i}`),
        last_activity_at: 1_794_720_000 + i,
      };
    }
    const { calls } = stub({
      contact: { payload: { conversations: rows } },
      reads,
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'shopper',
      page: 1,
    });

    expect(result.ok && result.results).toHaveLength(20);
    expect(result.ok && result.results[0].conversation.id).toBe(20);
    expect(
      calls.filter((u) => /\/conversations\/\d+$/.test(u.pathname))
    ).toHaveLength(20);
  });
});
