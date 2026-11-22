import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  binding,
  conversation,
  message,
  stubFetch,
} from './merchant-inbox-client.test-support';
import { searchMerchantInboxConversations } from './merchant-inbox-search-client';

afterEach(() => vi.unstubAllGlobals());

const hit = (id: number, inboxId: number, text = 'where is my order') => ({
  ...conversation(id, inboxId),
  meta: { sender: { name: 'Ada' } },
  messages: [message(id * 10, { content: text })],
});

describe('searchMerchantInboxConversations', () => {
  it('searches with the query and returns matches with a snippet', async () => {
    const fetchMock = stubFetch(() => ({ body: { payload: [hit(1, 20)] } }));

    const result = await searchMerchantInboxConversations(binding, {
      q: 'order',
      page: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      hasMore: true,
      results: [
        {
          conversation: { id: 1, customerName: 'Ada' },
          snippet: 'where is my order',
        },
      ],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v1/accounts/2/conversations/search');
    expect(url.searchParams.get('q')).toBe('order');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('drops matches from other inboxes of the same account', async () => {
    stubFetch(() => ({ body: { payload: [hit(1, 20), hit(2, 99)] } }));

    const result = await searchMerchantInboxConversations(binding, {
      q: 'order',
      page: 1,
    });

    expect(result.ok && result.results.map((r) => r.conversation.id)).toEqual([
      1,
    ]);
  });

  it('accepts rows nested under data and never shows private notes', async () => {
    const privateHit = {
      ...hit(3, 20),
      messages: [message(1, { private: true, content: 'internal note' })],
    };
    stubFetch(() => ({ body: { data: { payload: [privateHit] } } }));

    const result = await searchMerchantInboxConversations(binding, {
      q: 'note',
      page: 1,
    });

    expect(result.ok && result.results[0].snippet).toBeNull();
  });

  it('stops paging on an empty provider page', async () => {
    stubFetch(() => ({ body: { payload: [] } }));
    await expect(
      searchMerchantInboxConversations(binding, { q: 'zz', page: 5 })
    ).resolves.toEqual({ ok: true, results: [], hasMore: false });
  });

  it('reports unavailable for an unreadable answer or provider error', async () => {
    stubFetch(() => ({ body: { nope: true } }));
    await expect(
      searchMerchantInboxConversations(binding, { q: 'zz', page: 1 })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });

    stubFetch(() => ({ status: 502 }));
    await expect(
      searchMerchantInboxConversations(binding, { q: 'zz', page: 1 })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });
});
