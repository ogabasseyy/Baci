import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  binding,
  conversation,
  stubFetch,
} from './merchant-inbox-client.test-support';
import { updateMerchantInboxConversation } from './merchant-inbox-manage-client';

afterEach(() => vi.unstubAllGlobals());

const NOW = Date.parse('2026-11-22T10:00:00Z');

type Call = { method: string; path: string; body: unknown };

function recorder(
  live: Record<string, unknown> = {
    ...conversation(7),
    labels: ['handled-by-ai'],
  }
) {
  const calls: Call[] = [];
  const fetchMock = stubFetch((url, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname.replace('/api/v1/accounts/2', ''),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return init?.method === 'POST' ? { body: {} } : { body: live };
  });
  return { calls, fetchMock };
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST');

describe('updateMerchantInboxConversation', () => {
  it('marks a chat Done and drops its follow-up label', async () => {
    const { calls } = recorder({
      ...conversation(7),
      labels: ['follow-up', 'handled-by-ai'],
    });

    const result = await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update: { status: 'resolved' },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(posts(calls)).toEqual([
      {
        method: 'POST',
        path: '/conversations/7/toggle_status',
        body: { status: 'resolved' },
      },
      {
        method: 'POST',
        path: '/conversations/7/labels',
        body: { labels: ['handled-by-ai'] },
      },
    ]);
  });

  it('snoozes for a follow-up and adds the follow-up label', async () => {
    const { calls } = recorder();
    const at = '2026-11-23T08:00:00.000Z';

    await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update: { followUpAt: at },
      now: NOW,
    });

    expect(posts(calls)[0]).toMatchObject({
      path: '/conversations/7/toggle_status',
      body: { status: 'snoozed', snoozed_until: Date.parse(at) / 1000 },
    });
    expect(posts(calls)[1]).toMatchObject({
      path: '/conversations/7/labels',
      body: { labels: ['handled-by-ai', 'follow-up'] },
    });
  });

  it.each([
    ['in the past', '2026-11-21T08:00:00.000Z'],
    ['more than 90 days away', '2027-03-30T08:00:00.000Z'],
  ])('refuses a follow-up %s without writing anything', async (_name, at) => {
    const { calls } = recorder();

    await expect(
      updateMerchantInboxConversation(binding, {
        conversationId: 7,
        update: { followUpAt: at },
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, code: 'invalid_follow_up' });
    expect(posts(calls)).toEqual([]);
  });

  it('sets and clears priority', async () => {
    const { calls } = recorder();

    await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update: { priority: 'urgent' },
    });
    await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update: { priority: null },
    });

    expect(
      posts(calls).filter((c) => c.path.endsWith('toggle_priority'))
    ).toEqual([
      expect.objectContaining({ body: { priority: 'urgent' } }),
      expect.objectContaining({ body: { priority: null } }),
    ]);
  });

  it('merges tags into the live labels so system labels survive', async () => {
    const { calls } = recorder({
      ...conversation(7),
      labels: ['needs-human', 'tag-old'],
    });

    await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update: { addTags: ['payment'], removeTags: ['old'] },
    });

    expect(posts(calls)).toEqual([
      expect.objectContaining({
        path: '/conversations/7/labels',
        body: { labels: ['needs-human', 'tag-payment'] },
      }),
    ]);
  });

  it('never writes to a conversation outside the bound inbox', async () => {
    const { calls } = recorder({ ...conversation(7, 99), labels: [] });

    await expect(
      updateMerchantInboxConversation(binding, {
        conversationId: 7,
        update: { status: 'resolved' },
      })
    ).resolves.toEqual({ ok: false, code: 'not_found' });
    expect(posts(calls)).toEqual([]);
  });

  it('reports unavailable when the provider refuses a write', async () => {
    stubFetch((_url, init) =>
      init?.method === 'POST'
        ? { status: 500 }
        : { body: { ...conversation(7), labels: [] } }
    );

    await expect(
      updateMerchantInboxConversation(binding, {
        conversationId: 7,
        update: { status: 'resolved' },
      })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });
  });
});
