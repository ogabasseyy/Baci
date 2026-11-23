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

  it('adds the follow-up label and then snoozes for a follow-up', async () => {
    const { calls } = recorder();
    const at = '2026-11-23T08:00:00.000Z';

    await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update: { followUpAt: at },
      now: NOW,
    });

    expect(posts(calls)[0]).toMatchObject({
      path: '/conversations/7/labels',
      body: { labels: ['handled-by-ai', 'follow-up'] },
    });
    expect(posts(calls)[1]).toMatchObject({
      path: '/conversations/7/toggle_status',
      body: { status: 'snoozed', snoozed_until: Date.parse(at) / 1000 },
    });
    expect(posts(calls)).toHaveLength(2);
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

/** A chat whose labels really change, with one write that can be made to fail. */
function chatWithLabels(initial: string[], failing?: string) {
  let labels = initial;
  const calls: Call[] = [];
  stubFetch((url, init) => {
    const path = url.pathname.replace('/api/v1/accounts/2', '');
    if (init?.method !== 'POST')
      return { body: { ...conversation(7), labels } };
    const body = JSON.parse(String(init.body));
    calls.push({ method: 'POST', path, body });
    if (failing && path.endsWith(failing)) return { status: 500 };
    if (path.endsWith('/labels')) labels = body.labels;
    return { body: {} };
  });
  return { calls, labels: () => labels };
}

describe('bugfix: a follow-up never ends up half applied', () => {
  const update = { followUpAt: '2026-11-23T08:00:00.000Z' };

  it('does not snooze the chat when the follow-up label cannot be saved', async () => {
    const { calls, labels } = chatWithLabels(['handled-by-ai'], '/labels');

    await expect(
      updateMerchantInboxConversation(binding, {
        conversationId: 7,
        update,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });

    // A chat snoozed without the label would vanish from the Follow-up view.
    expect(calls.map((c) => c.path)).toEqual(['/conversations/7/labels']);
    expect(labels()).toEqual(['handled-by-ai']);
  });

  it('takes the label off again when the snooze fails', async () => {
    const { calls, labels } = chatWithLabels(
      ['handled-by-ai'],
      '/toggle_status'
    );

    await expect(
      updateMerchantInboxConversation(binding, {
        conversationId: 7,
        update,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });

    expect(calls.map((c) => c.path)).toEqual([
      '/conversations/7/labels',
      '/conversations/7/toggle_status',
      '/conversations/7/labels',
    ]);
    expect(labels()).toEqual(['handled-by-ai']);
  });

  it('keeps the label of an existing follow-up when changing its time fails', async () => {
    const { calls, labels } = chatWithLabels(
      ['follow-up', 'handled-by-ai'],
      '/toggle_status'
    );

    await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update,
      now: NOW,
    });

    // The earlier snooze is still in place, so its label must stay too.
    expect(calls.filter((c) => c.path.endsWith('/labels'))).toHaveLength(1);
    expect(labels()).toContain('follow-up');
  });

  it('applies tags sent with the follow-up in the same label write', async () => {
    const { calls, labels } = chatWithLabels(['handled-by-ai']);

    await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update: { ...update, addTags: ['payment'] },
      now: NOW,
    });

    expect(calls.filter((c) => c.path.endsWith('/labels'))).toHaveLength(1);
    expect(labels()).toEqual(['handled-by-ai', 'tag-payment', 'follow-up']);
  });
});
