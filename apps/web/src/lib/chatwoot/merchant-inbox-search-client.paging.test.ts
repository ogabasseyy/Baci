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

describe('searchMerchantInboxConversations paging and volume', () => {
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

  it('bugfix: keeps every match of a provider page, none lost beyond twenty', async () => {
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

    expect(result.ok && result.results).toHaveLength(30);
    // Newest first, and the ones past twenty are present.
    expect(result.ok && result.results[0].conversation.id).toBe(30);
    expect(
      result.ok && result.results.some((r) => r.conversation.id === 21)
    ).toBe(true);
    expect(
      calls.filter((u) => /\/conversations\/\d+$/.test(u.pathname))
    ).toHaveLength(30);
  });

  it('merges both searches at their full page sizes without losing any', async () => {
    const message = Array.from({ length: 25 }, (_, i) => messageRow(i + 1, 20));
    const contact = Array.from({ length: 15 }, (_, i) =>
      contactRow(i + 100, 20)
    );
    const reads: Record<number, unknown> = {};
    for (const id of [
      ...message.map((m) => m.id),
      ...contact.map((c) => c.id),
    ]) {
      reads[id] = named(id, `Shopper ${id}`);
    }
    stub({
      message: { meta: {}, payload: message },
      contact: { payload: { conversations: contact } },
      reads,
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'x',
      page: 1,
    });

    expect(result.ok && result.results).toHaveLength(40);
  });
});
