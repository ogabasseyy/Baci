import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { binding } from './merchant-inbox-client.test-support';
import { updateMerchantInboxConversation } from './merchant-inbox-manage-client';
import {
  chatWithLabels,
  NOW,
} from './merchant-inbox-manage-client.test-support';

afterEach(() => vi.unstubAllGlobals());

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

  it('takes the label off again when the engine refuses the snooze', async () => {
    const { calls, labels } = chatWithLabels(
      ['handled-by-ai'],
      '/toggle_status',
      { failStatus: 422 }
    );

    await expect(
      updateMerchantInboxConversation(binding, {
        conversationId: 7,
        update,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });

    // A refusal is a clear "not snoozed", so the label goes back off.
    expect(calls.map((c) => c.path)).toEqual([
      '/conversations/7/labels',
      '/conversations/7/toggle_status',
      '/conversations/7/labels',
    ]);
    expect(labels()).toEqual(['handled-by-ai']);
  });

  it('bugfix: never takes the label off after a snooze with no clear answer, even if the engine still shows the old state', async () => {
    // A server error or timeout: the snooze may land after any check made now.
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

    expect(labels()).toContain('follow-up');
    expect(calls.filter((c) => c.path.endsWith('/labels'))).toHaveLength(1);
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

  it('keeps the label when the snooze was applied but its reply got lost', async () => {
    const { calls, labels } = chatWithLabels(
      ['handled-by-ai'],
      '/toggle_status',
      {
        lostReply: true,
      }
    );

    const result = await updateMerchantInboxConversation(binding, {
      conversationId: 7,
      update,
      now: NOW,
    });

    // The chat is snoozed, so the label must stay or it would vanish from view.
    expect(result.ok).toBe(true);
    expect(labels()).toContain('follow-up');
    expect(calls.filter((c) => c.path.endsWith('/labels'))).toHaveLength(1);
  });

  it('keeps the label when the engine cannot be asked what happened', async () => {
    const { calls, labels } = chatWithLabels(
      ['handled-by-ai'],
      '/toggle_status',
      {
        readsDownAfterFailure: true,
      }
    );

    await expect(
      updateMerchantInboxConversation(binding, {
        conversationId: 7,
        update,
        now: NOW,
      })
    ).resolves.toEqual({ ok: false, code: 'unavailable' });

    // Unknown is not "not snoozed": a visible follow-up beats a vanished one.
    expect(labels()).toContain('follow-up');
    expect(calls.filter((c) => c.path.endsWith('/labels'))).toHaveLength(1);
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
