import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  sync: vi.fn(),
  hold: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./merchant-inbox-client', () => ({
  getMerchantInboxConversation: mocks.read,
}));
vi.mock('./chat-follow-up-reminder-hold', () => ({
  holdUnconfirmedChatFollowUpReminder: mocks.hold,
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
const seen = { revision: 'rev-1', dueAt: '2026-11-25T08:00:00.000Z' };
const engine = (conversation: Record<string, unknown>) =>
  mocks.read.mockResolvedValue({
    ok: true,
    conversation: { id: 7, customerName: 'Ada', ...conversation },
  });
const recover = (
  followUpAt?: string | null,
  sent?: { state: 'applied' | 'unconfirmed'; customerName: string }
) =>
  recoverAcceptedFollowUpReminder(client, binding, {
    conversationId: 7,
    update: { followUpAt, priority: 'high' },
    seen,
    sent,
  });
const unreadable = () =>
  mocks.read.mockResolvedValue({ ok: false, code: 'unavailable' });

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
      seen,
      recheck: expect.any(Function),
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

  it('bugfix: records an applied follow-up even when the chat cannot be read back', async () => {
    unreadable();
    await recover(requested, { state: 'applied', customerName: 'Ada' });
    expect(mocks.sync).toHaveBeenCalledWith(client, {
      merchantId: 'm',
      conversationId: 7,
      update: { followUpAt: requested, priority: 'high' },
      customerName: 'Ada',
      seen,
      recheck: expect.any(Function),
      observed: undefined,
    });
    expect(mocks.hold).not.toHaveBeenCalled();
  });

  it.each([
    ['the snooze has not landed yet', () => engine({ status: 'open' })],
    ['the chat cannot be read', unreadable],
  ])('bugfix: holds an unconfirmed follow-up when %s', async (_label, arrange) => {
    arrange();
    await recover(requested, { state: 'unconfirmed', customerName: 'Ada' });
    expect(mocks.hold).toHaveBeenCalledWith(client, {
      merchantId: 'm',
      conversationId: 7,
      dueAt: '2026-11-25T09:00:00.000Z',
      customerName: 'Ada',
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('holds the time to the whole second the engine was sent', async () => {
    engine({ status: 'open' });
    await recover('2026-11-25T09:00:00.900Z', {
      state: 'unconfirmed',
      customerName: 'Ada',
    });
    expect(mocks.hold.mock.calls[0][1].dueAt).toBe('2026-11-25T09:00:00.000Z');
  });

  it('records an unconfirmed follow-up as usual once the chat shows it', async () => {
    await recover(requested, { state: 'unconfirmed', customerName: 'Ada' });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.hold).not.toHaveBeenCalled();
  });
});

describe('bugfix: a cancellation that failed partway still drops the reminder', () => {
  const cancelled = (
    update: { followUpAt?: null; status?: 'resolved' },
    cancelSent: 'applied' | 'unconfirmed' = 'applied'
  ) =>
    recoverAcceptedFollowUpReminder(client, binding, {
      conversationId: 7,
      update,
      seen,
      cancelSent,
    });

  it.each([
    ['a clear', { followUpAt: null }],
    ['Done', { status: 'resolved' as const }],
  ])('syncs %s with what the chat shows', async (_name, update) => {
    engine({ status: 'open', followUp: true });
    await cancelled(update);
    expect(mocks.sync).toHaveBeenCalledWith(client, {
      merchantId: 'm',
      conversationId: 7,
      update,
      customerName: 'Ada',
      seen,
      recheck: expect.any(Function),
      observed: { status: 'open', followUp: true, snoozedUntil: undefined },
    });
    expect(mocks.hold).not.toHaveBeenCalled();
  });

  it('syncs an applied one when the chat cannot be read back', async () => {
    unreadable();
    await cancelled({ followUpAt: null });
    expect(mocks.sync).toHaveBeenCalledWith(client, {
      merchantId: 'm',
      conversationId: 7,
      update: { followUpAt: null },
      customerName: '',
      seen,
      recheck: expect.any(Function),
      observed: undefined,
    });
  });

  it.each([
    ['a clear', { followUpAt: null }],
    ['Done', { status: 'resolved' as const }],
  ])('bugfix: keeps the reminder when %s got no answer and the chat cannot be read', async (_name, update) => {
    unreadable();
    await cancelled(update, 'unconfirmed');
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.hold).not.toHaveBeenCalled();
  });

  it('lets the chat decide an unanswered cancellation it can read', async () => {
    engine({ status: 'resolved', followUp: true });
    await cancelled({ status: 'resolved' }, 'unconfirmed');
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });
});
