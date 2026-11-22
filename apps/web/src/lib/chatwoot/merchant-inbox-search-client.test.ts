import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { binding } from './merchant-inbox-client.test-support';
import { searchMerchantInboxConversations } from './merchant-inbox-search-client';
import {
  contactRow,
  messageRow,
  named,
  stub,
} from './merchant-inbox-search-client.test-support';

afterEach(() => vi.unstubAllGlobals());

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
});
