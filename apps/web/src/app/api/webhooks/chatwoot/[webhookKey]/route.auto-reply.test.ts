import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBinding: vi.fn(),
  verify: vi.fn(),
  record: vi.fn(),
  push: vi.fn(),
  after: vi.fn(),
  assistantBinding: vi.fn(),
  run: vi.fn(),
  takeover: vi.fn(),
  inboxBinding: vi.fn(),
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
vi.mock('@/lib/chatwoot/chat-auto-reply-config', () => ({
  getChatAutoReplyBinding: mocks.assistantBinding,
}));
vi.mock('@/lib/chatwoot/merchant-inbox-config', () => ({
  getMerchantInboxBinding: mocks.inboxBinding,
}));
vi.mock('@/lib/chatwoot/chat-auto-reply', () => ({
  runChatAutoReply: mocks.run,
  recordMerchantTakeover: mocks.takeover,
}));

import { binding, call, payload } from './route.test-support';

const inbox = { ...binding, apiAccessToken: 'synthetic-agent-token-aaaa' };
const assistant = { ...inbox, botApiAccessToken: 'synthetic-bot-token-bbbb' };
const pending: Promise<unknown>[] = [];
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
  mocks.assistantBinding.mockReturnValue(assistant);
  mocks.inboxBinding.mockReturnValue(inbox);
  mocks.run.mockResolvedValue('replied');
  mocks.takeover.mockResolvedValue('replied');
  mocks.after.mockImplementation((work: () => Promise<unknown>) => {
    pending.push(work());
  });
  pending.length = 0;
});

describe('POST /api/webhooks/chatwoot/[webhookKey] assistant', () => {
  it('lets the assistant answer a new customer message', async () => {
    const response = await call(
      payload({ conversation: { id: 21, status: 'pending' } })
    );
    await settle();
    expect(response.status).toBe(200);
    expect(mocks.assistantBinding).toHaveBeenCalledWith(binding.merchantId);
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.run.mock.calls[0][0]).toBe(assistant);
    expect(mocks.run.mock.calls[0][1]).toMatchObject({ id: 128 });
  });

  it('does not answer a redelivered message twice', async () => {
    mocks.record.mockResolvedValue({
      ok: true,
      outcome: 'coalesced',
      duplicate: true,
    });
    await call(payload());
    await settle();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('stays off when the store has no assistant switched on', async () => {
    mocks.assistantBinding.mockReturnValue(null);
    const response = await call(payload());
    await settle();
    expect(response.status).toBe(200);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('does not answer when recording the message failed', async () => {
    mocks.record.mockResolvedValue({ ok: false, code: 'unavailable' });
    const response = await call(payload());
    await settle();
    expect(response.status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('treats a staff reply as a takeover, not a customer message', async () => {
    const response = await call(
      payload({
        message_type: 'outgoing',
        sender: { type: 'user', name: 'Staff' },
      })
    );
    await settle();
    expect(await response.json()).toEqual({ received: true, handled: false });
    expect(mocks.takeover).toHaveBeenCalledOnce();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('records a staff takeover even when the assistant is switched off', async () => {
    mocks.assistantBinding.mockReturnValue(null);
    await call(payload({ message_type: 'outgoing', sender: { type: 'user' } }));
    await settle();
    expect(mocks.takeover).toHaveBeenCalledOnce();
    expect(mocks.takeover.mock.calls[0][0].botApiAccessToken).toBe(
      inbox.apiAccessToken
    );
  });

  it('does not record a takeover from an inbox binding for another account', async () => {
    mocks.inboxBinding.mockReturnValue({ ...inbox, accountId: 9999 });
    await call(payload({ message_type: 'outgoing', sender: { type: 'user' } }));
    await settle();
    expect(mocks.takeover).not.toHaveBeenCalled();
  });

  it('ignores the assistant bot own messages', async () => {
    await call(
      payload({ message_type: 'outgoing', sender: { type: 'agent_bot' } })
    );
    await settle();
    expect(mocks.takeover).toHaveBeenCalledTimes(0);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('ignores a staff reply from another store inbox', async () => {
    await call(
      payload({
        message_type: 'outgoing',
        sender: { type: 'user' },
        inbox: { id: 999 },
      })
    );
    await settle();
    expect(mocks.takeover).not.toHaveBeenCalled();
  });

  it('does not answer for a store the database no longer knows', async () => {
    mocks.record.mockResolvedValue({
      ok: true,
      outcome: 'ignored',
      duplicate: false,
    });
    await call(payload());
    await settle();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('still answers when the merchant muted notifications', async () => {
    mocks.record.mockResolvedValue({
      ok: true,
      outcome: 'muted',
      duplicate: false,
    });
    await call(payload());
    await settle();
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('never uses a credential from a different account or inbox than the signed webhook', async () => {
    mocks.assistantBinding.mockReturnValue({ ...assistant, accountId: 9999 });
    await call(payload());
    await settle();
    expect(mocks.run).not.toHaveBeenCalled();

    mocks.assistantBinding.mockReturnValue({ ...assistant, inboxId: 9999 });
    await call(payload());
    await settle();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
