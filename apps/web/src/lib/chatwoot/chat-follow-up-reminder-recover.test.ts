import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), sync: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./merchant-inbox-client', () => ({
  getMerchantInboxConversation: mocks.read,
}));
vi.mock('./chat-follow-up-reminder-sync', () => ({
  syncChatFollowUpReminder: mocks.sync,
}));

import { recoverAcceptedFollowUpReminder } from './chat-follow-up-reminder-recover';

const client = { from: vi.fn() };
const binding = { merchantId: 'm' } as unknown as Parameters<
  typeof recoverAcceptedFollowUpReminder
>[1];
const requested = '2026-11-25T09:00:00Z';
const engine = (conversation: Record<string, unknown>) =>
  mocks.read.mockResolvedValue({
    ok: true,
    conversation: { id: 7, customerName: 'Ada', ...conversation },
  });
const recover = (followUpAt?: string | null) =>
  recoverAcceptedFollowUpReminder(client, binding, {
    conversationId: 7,
    update: { followUpAt, priority: 'high' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  engine({
    status: 'snoozed',
    followUp: true,
    snoozedUntil: '2026-11-25T09:00:30.000Z',
  });
});

describe('recoverAcceptedFollowUpReminder', () => {
  it('records a follow-up the chat engine shows as applied', async () => {
    await recover(requested);
    expect(mocks.read).toHaveBeenCalledWith(binding, 7);
    expect(mocks.sync).toHaveBeenCalledWith(client, {
      merchantId: 'm',
      conversationId: 7,
      update: { followUpAt: requested, priority: 'high' },
      customerName: 'Ada',
      observed: {
        status: 'snoozed',
        followUp: true,
        snoozedUntil: '2026-11-25T09:00:30.000Z',
      },
    });
  });

  it.each([
    ['the chat is not snoozed', { status: 'open' }],
    ['the snooze has no time', { status: 'snoozed' }],
    [
      'the snooze is for another time',
      { status: 'snoozed', snoozedUntil: '2026-11-26T09:00:00.000Z' },
    ],
  ])('records nothing when %s', async (_label, conversation) => {
    engine(conversation);
    await recover(requested);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('records nothing when the chat engine cannot be read', async () => {
    mocks.read.mockResolvedValue({ ok: false, code: 'unavailable' });
    await recover(requested);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it.each([
    null,
    undefined,
  ])('does not read the chat for a change that sets no follow-up (%s)', async (followUpAt) => {
    await recover(followUpAt);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
