import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkFollowUpStillDue } from './chat-follow-up-reminder-check';

const reminder = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  conversationId: 7,
  dueAt: '2026-11-25T09:00:00.000Z',
};
const binding = { merchantId: reminder.merchantId } as never;

function check(read: unknown, bound = true) {
  return checkFollowUpStillDue(reminder, {
    getBinding: () => (bound ? binding : null),
    getConversation: vi.fn(async () => read) as never,
  });
}
const found = (conversation: Record<string, unknown>) => ({
  ok: true,
  conversation: { id: 7, status: 'open', followUp: true, ...conversation },
});

describe('checkFollowUpStillDue', () => {
  it('is due for a reopened chat that still carries the follow-up label', async () => {
    await expect(check(found({}))).resolves.toBe('due');
  });

  it('is due for a chat still snoozed to the same time', async () => {
    await expect(
      check(
        found({
          status: 'snoozed',
          snoozedUntil: '2026-11-25T09:00:20.000Z',
        })
      )
    ).resolves.toBe('due');
  });

  it('is stale for a chat marked Done', async () => {
    await expect(check(found({ status: 'resolved' }))).resolves.toBe('stale');
  });

  it('is stale when the follow-up label was removed', async () => {
    await expect(check(found({ followUp: false }))).resolves.toBe('stale');
  });

  it('is stale when the chat was snoozed to another time', async () => {
    await expect(
      check(
        found({ status: 'snoozed', snoozedUntil: '2026-11-27T09:00:00.000Z' })
      )
    ).resolves.toBe('stale');
  });

  it('is stale for a snoozed chat that shows no snooze time', async () => {
    await expect(
      check(found({ status: 'snoozed', snoozedUntil: null }))
    ).resolves.toBe('stale');
  });

  it('is stale when the chat no longer exists', async () => {
    await expect(check({ ok: false, code: 'not_found' })).resolves.toBe(
      'stale'
    );
  });

  it('is unknown, not stale, when the engine cannot be read', async () => {
    await expect(check({ ok: false, code: 'unavailable' })).resolves.toBe(
      'unknown'
    );
  });

  it('is unknown when the store has no engine binding', async () => {
    await expect(check(found({}), false)).resolves.toBe('unknown');
  });
});
