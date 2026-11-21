import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ record: vi.fn(), push: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./chat-handover-intake', () => ({
  recordChatHandover: mocks.record,
}));
vi.mock('./chat-event-push', () => ({ sendChatEventPush: mocks.push }));

import { alertMerchantOfHandover } from './chat-handover-alert';

const input = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  eventKey: 'chat-handover-2-128',
  conversationId: 21,
  customerName: 'Ada',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.record.mockResolvedValue({
    ok: true,
    outcome: 'notified',
    duplicate: false,
  });
  mocks.push.mockResolvedValue({ status: 'sent', sent: 1, failed: 0 });
});

describe('alertMerchantOfHandover', () => {
  it('records the handover, then pushes it as a handover', async () => {
    await expect(alertMerchantOfHandover(input)).resolves.toBe('notified');
    expect(mocks.record).toHaveBeenCalledWith(input);
    expect(mocks.push).toHaveBeenCalledWith({
      ...input,
      preview: '',
      kind: 'handover',
    });
  });

  it.each([
    ['the merchant turned alerts off', { outcome: 'muted', duplicate: false }],
    [
      'the hourly budget is used up',
      { outcome: 'coalesced', duplicate: false },
    ],
    ['the store is unknown', { outcome: 'ignored', duplicate: false }],
    ['it is a redelivery', { outcome: 'notified', duplicate: true }],
  ])('does not push when %s', async (_label, result) => {
    mocks.record.mockResolvedValue({ ok: true, ...result });
    await alertMerchantOfHandover(input);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('reports failed and does not push when the handover cannot be recorded', async () => {
    mocks.record.mockResolvedValue({ ok: false, code: 'unavailable' });
    await expect(alertMerchantOfHandover(input)).resolves.toBe('failed');
    expect(mocks.push).not.toHaveBeenCalled();
    // Logged without customer text so a broken alert path is visible.
    expect(console.warn).toHaveBeenCalledWith(
      'Chat handover alert was not recorded',
      {
        eventKey: input.eventKey,
        merchantId: input.merchantId,
        code: 'unavailable',
      }
    );
  });

  it('never throws, even when recording or pushing blows up', async () => {
    mocks.record.mockRejectedValue(new Error('boom'));
    await expect(alertMerchantOfHandover(input)).resolves.toBe('failed');
    mocks.record.mockResolvedValue({
      ok: true,
      outcome: 'notified',
      duplicate: false,
    });
    mocks.push.mockRejectedValue(new Error('push boom'));
    await expect(alertMerchantOfHandover(input)).resolves.toBe('notified');
  });

  it('keeps the recorded alert when the push fails, and logs it without customer text', async () => {
    mocks.push.mockResolvedValue({ status: 'failed' });
    await expect(alertMerchantOfHandover(input)).resolves.toBe('notified');
    expect(console.warn).toHaveBeenCalledWith(
      'Chat handover push was not sent',
      {
        eventKey: input.eventKey,
        merchantId: input.merchantId,
        status: 'failed',
      }
    );
  });

  it('does not log when the push was muted or already claimed', async () => {
    mocks.push.mockResolvedValue({ status: 'skipped', reason: 'muted' });
    await alertMerchantOfHandover(input);
    mocks.push.mockResolvedValue({
      status: 'skipped',
      reason: 'already_claimed',
    });
    await alertMerchantOfHandover(input);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
