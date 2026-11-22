import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBinding: vi.fn(),
  verify: vi.fn(),
  record: vi.fn(),
  push: vi.fn(),
  after: vi.fn(),
}));

vi.mock('next/server', async () => {
  const actual: Record<string, unknown> = await vi.importActual('next/server');
  return { ...actual, after: mocks.after };
});
vi.mock('@/lib/chatwoot/chat-webhook-config', () => ({
  getChatWebhookBinding: mocks.getBinding,
}));
vi.mock('@/lib/chatwoot/chat-webhook-signature', () => ({
  verifyChatWebhookSignature: mocks.verify,
}));
vi.mock('@/lib/chatwoot/chat-event-intake', () => ({
  CHAT_EVENT_NAME_MAX_LENGTH: 80,
  CHAT_EVENT_PREVIEW_MAX_LENGTH: 280,
  normalizeChatEventText: (value: string | null | undefined, max: number) =>
    (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max),
  recordChatCustomerMessage: mocks.record,
}));
vi.mock('@/lib/chatwoot/chat-event-push', () => ({
  sendChatEventPush: mocks.push,
}));

import { binding, call, payload } from './route.test-support';

const pending: Promise<void>[] = [];
const settle = () => Promise.all(pending);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBinding.mockReturnValue(binding);
  mocks.verify.mockReturnValue(true);
  mocks.record.mockResolvedValue({
    ok: true,
    outcome: 'notified',
    duplicate: false,
  });
  mocks.push.mockResolvedValue({ status: 'sent', sent: 1, failed: 0 });
  // Run the deferred push the way the framework does once the response is out.
  mocks.after.mockImplementation((work: () => Promise<void>) => {
    pending.push(work());
  });
  pending.length = 0;
});

describe('POST /api/webhooks/chatwoot/[webhookKey] push', () => {
  it('pushes once for a newly notified message', async () => {
    await call(payload());
    await settle();
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith({
      merchantId: binding.merchantId,
      eventKey: 'chat-msg-2-128',
      conversationId: 21,
      customerName: 'Ada',
      preview: 'Do you have the Demo Phone X?',
    });
  });

  it.each([
    ['a redelivered message', { outcome: 'notified', duplicate: true }],
    ['a merged message', { outcome: 'coalesced', duplicate: false }],
    ['a muted store', { outcome: 'muted', duplicate: false }],
    ['an unknown store', { outcome: 'ignored', duplicate: false }],
  ])('does not push for %s', async (_label, outcome) => {
    mocks.record.mockResolvedValue({ ok: true, ...outcome });
    const response = await call(payload());
    await settle();
    expect(response.status).toBe(200);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('still acknowledges the webhook when the push fails', async () => {
    mocks.push.mockRejectedValue(new Error('expo down'));
    const response = await call(payload());
    await settle();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      handled: true,
    });
  });

  it.each([
    ['a failed push', { status: 'failed' }, 'failed'],
    [
      'a missing push secret',
      { status: 'skipped', reason: 'not_configured' },
      'skipped:not_configured',
    ],
  ])('logs %s without customer text', async (_label, push, status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.push.mockResolvedValue(push);
    const response = await call(payload());
    await settle();

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith('Chat message push was not sent', {
      eventKey: 'chat-msg-2-128',
      merchantId: binding.merchantId,
      status,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Demo Phone');
    warn.mockRestore();
  });

  it('logs a push that threw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.push.mockRejectedValue(new Error('expo down'));
    await call(payload());
    await settle();
    expect(warn).toHaveBeenCalledWith(
      'Chat message push was not sent',
      expect.objectContaining({ status: 'failed' })
    );
    warn.mockRestore();
  });

  it.each([
    ['a sent push', { status: 'sent', sent: 1, failed: 0 }],
    [
      'a claim lost to another delivery',
      { status: 'skipped', reason: 'already_claimed' },
    ],
    ['a push the merchant turned off', { status: 'skipped', reason: 'muted' }],
  ])('does not log %s', async (_label, push) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.push.mockResolvedValue(push);
    await call(payload());
    await settle();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not push when the notification could not be recorded', async () => {
    mocks.record.mockResolvedValue({ ok: false, code: 'unavailable' });
    await call(payload());
    await settle();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('answers 200 even when the push never settles', async () => {
    mocks.push.mockReturnValue(new Promise(() => undefined));
    const response = await call(payload());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      handled: true,
    });
    // The push was only scheduled, not awaited by the handler.
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledOnce();
  });
});
