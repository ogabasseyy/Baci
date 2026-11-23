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

  it('reads at most the providers own page size, never an unbounded fan-out', async () => {
    // An answer far larger than Chatwoot ever sends (25 and 15 per page).
    const contact = Array.from({ length: 100 }, (_, i) =>
      contactRow(i + 1, 20)
    );
    const message = Array.from({ length: 100 }, (_, i) =>
      messageRow(i + 1000, 20)
    );
    const reads: Record<number, unknown> = {};
    for (const row of [...contact, ...message]) {
      reads[row.id] = { ...named(row.id, `Shopper ${row.id}`) };
    }
    const { calls } = stub({
      contact: { payload: { conversations: contact } },
      message: { meta: {}, payload: message },
      reads,
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'x',
      page: 1,
    });

    const reads_ = calls.filter((u) =>
      /\/conversations\/\d+$/.test(u.pathname)
    );
    expect(reads_).toHaveLength(40);
    expect(result.ok && result.results).toHaveLength(40);
  });

  it('makes no conversation reads for a page made only of other stores chats', async () => {
    const other = Array.from({ length: 100 }, (_, i) => contactRow(i + 1, 99));
    const { calls } = stub({
      contact: { payload: { conversations: other } },
      message: { meta: {}, payload: other.map((r) => messageRow(r.id, 99)) },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'x',
      page: 1,
    });

    expect(
      calls.filter((u) => /\/conversations\/\d+$/.test(u.pathname))
    ).toHaveLength(0);
    // Nothing for this store here, but the provider has more pages to look at.
    expect(result).toEqual({ ok: true, results: [], hasMore: true });
  });

  it('keeps every match of a full provider page, none lost', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => contactRow(i + 1, 20));
    const reads: Record<number, unknown> = {};
    for (let i = 1; i <= 15; i++) {
      reads[i] = {
        ...named(i, `Shopper ${i}`),
        last_activity_at: 1_794_720_000 + i,
      };
    }
    stub({ contact: { payload: { conversations: rows } }, reads });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'shopper',
      page: 1,
    });

    expect(result.ok && result.results).toHaveLength(15);
    // Newest first.
    expect(result.ok && result.results[0].conversation.id).toBe(15);
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

describe('bugfix: a page must not silently lose a match', () => {
  const rows = [contactRow(1, 20), contactRow(2, 20)];

  it('reports unavailable when one match could not be read, so the page can be asked for again', async () => {
    stub({
      contact: { payload: { conversations: rows } },
      reads: { 1: named(1, 'Ada') },
      readStatus: { 2: 503 },
    });

    await expect(
      searchMerchantInboxConversations(binding, { q: 'a', page: 1 })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });

  it('still leaves out a chat that is gone while keeping the others', async () => {
    // Chat 2 was deleted or moved: a plain 404, not an engine problem.
    stub({
      contact: { payload: { conversations: rows } },
      reads: { 1: named(1, 'Ada') },
    });

    const result = await searchMerchantInboxConversations(binding, {
      q: 'a',
      page: 1,
    });

    expect(result.ok && result.results.map((r) => r.conversation.id)).toEqual([
      1,
    ]);
  });
});

describe('bugfix: no next page past the last one the API accepts', () => {
  const answer = {
    contact: { payload: { conversations: [contactRow(1, 20)] } },
  };

  it('offers another page below the limit', async () => {
    stub({ ...answer, reads: { 1: named(1, 'Ada') } });
    const result = await searchMerchantInboxConversations(binding, {
      q: 'a',
      page: 49,
    });
    expect(result.ok && result.hasMore).toBe(true);
  });

  it('stops at page 50 even though the provider page was not empty', async () => {
    stub({ ...answer, reads: { 1: named(1, 'Ada') } });
    const result = await searchMerchantInboxConversations(binding, {
      q: 'a',
      page: 50,
    });
    expect(result.ok && result.hasMore).toBe(false);
  });
});
