import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./chat-event-push', () => ({ sendChatEventPush: vi.fn() }));
vi.mock('./chat-follow-up-reminder-check', () => ({
  checkFollowUpStillDue: vi.fn(),
}));

import { sweepChatFollowUpReminders } from './chat-follow-up-reminder-sweep';

const MERCHANT = 'c4a70000-0000-4000-8000-0000000000b1';
const reminder = (n: number, name = 'Ada') => ({
  reminder_id: `5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e0${n}`,
  merchant_id: MERCHANT,
  conversation_id: 10 + n,
  due_at: '2026-11-25T09:00:00+00:00',
  customer_name: name,
});

const mocks = {
  list: vi.fn(),
  check: vi.fn(),
  record: vi.fn(),
  push: vi.fn(),
  release: vi.fn(),
  now: vi.fn(),
};
const deps = mocks as unknown as Parameters<
  typeof sweepChatFollowUpReminders
>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.now.mockReturnValue(0);
  mocks.release.mockResolvedValue(true);
  mocks.list.mockResolvedValue({ ok: true, reminders: [reminder(1)] });
  mocks.check.mockResolvedValue('due');
  mocks.record.mockResolvedValue({ ok: true, outcome: 'notified' });
  mocks.push.mockResolvedValue({ status: 'sent', sent: 1, failed: 0 });
});

const summary = async () => {
  const result = await sweepChatFollowUpReminders(deps);
  if (!result.ok) throw new Error(`sweep failed: ${result.code}`);
  return result.summary;
};

describe('sweepChatFollowUpReminders', () => {
  it('takes a due reminder once and pushes it with the follow-up wording', async () => {
    await expect(summary()).resolves.toEqual({
      due: 1,
      sent: 1,
      skipped: 0,
      waiting: 0,
      deferred: 0,
      retrying: 0,
      failed: 0,
    });
    expect(mocks.record).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      reminderId: reminder(1).reminder_id,
      send: true,
    });
    expect(mocks.push).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      eventKey: 'fu-5f2d3c1e8a474b699c0e1a2b3c4d5e01',
      conversationId: 11,
      customerName: 'Ada',
      preview: '',
      kind: 'follow_up',
    });
  });

  it('bugfix: keeps an anonymous visitor name out of the push title even when the stored row has one', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      reminders: [reminder(1, 'withered-sun-554')],
    });
    await summary();
    expect(mocks.push).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: '' })
    );
  });

  it('sends nothing the second time: an already handled reminder is not listed', async () => {
    await summary();
    mocks.list.mockResolvedValue({ ok: true, reminders: [] });
    await expect(summary()).resolves.toMatchObject({ due: 0, sent: 0 });
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('does not push when the database says another sweep took it first', async () => {
    mocks.record.mockResolvedValue({ ok: true, outcome: 'ignored' });
    await expect(summary()).resolves.toMatchObject({ sent: 0, skipped: 1 });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('pushes nothing for a muted store', async () => {
    mocks.record.mockResolvedValue({ ok: true, outcome: 'muted' });
    await expect(summary()).resolves.toMatchObject({ sent: 0, skipped: 1 });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('consumes, without a push, a reminder for a chat that is finished or changed', async () => {
    mocks.check.mockResolvedValue('stale');
    mocks.record.mockResolvedValue({ ok: true, outcome: 'ignored' });
    await expect(summary()).resolves.toMatchObject({ sent: 0, skipped: 1 });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ send: false })
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('leaves a reminder for the next sweep when the chat engine cannot be read', async () => {
    mocks.check.mockResolvedValue('unknown');
    await expect(summary()).resolves.toMatchObject({ sent: 0, waiting: 1 });
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('counts a failed push and keeps going with the next reminder', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      reminders: [reminder(1), reminder(2, 'Bola')],
    });
    mocks.push
      .mockRejectedValueOnce(new Error('expo down'))
      .mockResolvedValueOnce({ status: 'sent', sent: 1, failed: 0 });

    await expect(summary()).resolves.toMatchObject({
      due: 2,
      sent: 1,
      failed: 1,
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      'Ada'
    );
  });

  it('keeps going when one reminder throws', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      reminders: [reminder(1), reminder(2)],
    });
    mocks.check.mockRejectedValueOnce(new Error('boom'));
    await expect(summary()).resolves.toMatchObject({ sent: 1, failed: 1 });
  });

  it('counts an unrecorded reminder as failed and sends nothing', async () => {
    mocks.record.mockResolvedValue({ ok: false, code: 'unavailable' });
    await expect(summary()).resolves.toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('stops starting reminders once the time budget is spent', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      reminders: [reminder(1), reminder(2)],
    });
    mocks.now.mockReturnValueOnce(0).mockReturnValue(60_000);
    await expect(summary()).resolves.toMatchObject({
      sent: 0,
      waiting: 0,
      deferred: 2,
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('reports a listing failure', async () => {
    mocks.list.mockResolvedValue({ ok: false, code: 'unavailable' });
    await expect(sweepChatFollowUpReminders(deps)).resolves.toEqual({
      ok: false,
      code: 'unavailable',
    });
  });
});

describe('bugfix: a failed push lost the follow-up for good', () => {
  it('puts the reminder back when the push never left the server', async () => {
    mocks.push.mockResolvedValue({ status: 'failed', nothingSent: true });
    await expect(summary()).resolves.toMatchObject({ retrying: 1, failed: 0 });
    expect(mocks.release).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      reminderId: reminder(1).reminder_id,
    });
  });

  it('counts it as failed when the database will not put it back', async () => {
    mocks.push.mockResolvedValue({ status: 'failed', nothingSent: true });
    mocks.release.mockResolvedValue(false);
    await expect(summary()).resolves.toMatchObject({ retrying: 0, failed: 1 });
  });

  it.each([
    [
      'the push may have left',
      () =>
        mocks.push.mockResolvedValue({ status: 'failed', nothingSent: false }),
    ],
    [
      'the push call throws',
      () => mocks.push.mockRejectedValue(new Error('boom')),
    ],
  ])('never retries when %s', async (_label, arrange) => {
    arrange();
    await expect(summary()).resolves.toMatchObject({ retrying: 0, failed: 1 });
    expect(mocks.release).not.toHaveBeenCalled();
  });
});

describe('bugfix: a store with no registered device used up the follow-up', () => {
  beforeEach(() => {
    mocks.push.mockResolvedValue({
      status: 'sent',
      sent: 0,
      failed: 0,
      noDevices: true,
    });
  });

  it('puts the reminder back and does not count it as sent', async () => {
    await expect(summary()).resolves.toMatchObject({ sent: 0, retrying: 1 });
    expect(mocks.release).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      reminderId: reminder(1).reminder_id,
    });
  });

  it('counts it as skipped once the database will not put it back', async () => {
    mocks.release.mockResolvedValue(false);
    await expect(summary()).resolves.toMatchObject({
      sent: 0,
      retrying: 0,
      skipped: 1,
      failed: 0,
    });
  });
});
