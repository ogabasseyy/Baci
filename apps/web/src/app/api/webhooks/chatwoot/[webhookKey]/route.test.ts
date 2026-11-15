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

import { binding, call, KEY, payload } from './route.test-support';

const pending: Promise<void>[] = [];

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

describe('POST /api/webhooks/chatwoot/[webhookKey]', () => {
  it('records a signed customer message for the bound store', async () => {
    const body = payload();
    const response = await call(body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      handled: true,
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.getBinding).toHaveBeenCalledWith(KEY);
    // The signature is checked over the exact received bytes.
    expect(mocks.verify).toHaveBeenCalledWith({
      rawBody: JSON.stringify(body),
      signatureHeader: 'sha256=abc',
      timestampHeader: '1794730000',
      secret: binding.webhookSecret,
    });
    expect(mocks.record).toHaveBeenCalledWith({
      merchantId: binding.merchantId,
      eventKey: 'chat-msg-2-128',
      conversationId: 21,
      customerName: 'Ada',
      preview: 'Do you have the Demo Phone X?',
    });
  });

  it('gives an unknown endpoint key the same 401 as a bad signature', async () => {
    mocks.getBinding.mockReturnValue(null);
    const unknown = await call(payload());
    mocks.getBinding.mockReturnValue(binding);
    mocks.verify.mockReturnValue(false);
    const forged = await call(payload());

    expect(unknown.status).toBe(401);
    expect(forged.status).toBe(401);
    await expect(unknown.json()).resolves.toEqual(await forged.json());
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('never parses or records an unsigned body', async () => {
    mocks.verify.mockReturnValue(false);
    const response = await call('{not json', true);
    expect(response.status).toBe(401);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each([
    ['another event', { event: 'conversation_updated' }],
    ['a store reply', { message_type: 'outgoing' }],
    ['an automatic template message', { message_type: 'template' }],
    ['a private note', { private: true }],
    ['another account', { account: { id: 3 } }],
    ['another inbox', { inbox: { id: 21 } }],
  ])('acknowledges and drops %s', async (_label, overrides) => {
    const response = await call(payload(overrides));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      handled: false,
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{not json', true],
    ['a body with no event', { id: 1 }, false],
    [
      'a message with no conversation',
      payload({ conversation: undefined }),
      false,
    ],
    ['a non-numeric message id', payload({ id: 'abc' }), false],
  ])('rejects signed %s as a client error', async (_label, body, raw) => {
    const response = await call(body, raw);
    expect(response.status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('refuses an oversized body before verifying anything', async () => {
    const response = await call(payload(), false, {
      'content-length': String(600 * 1024),
    });
    expect(response.status).toBe(413);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('builds an event key the database intake accepts even for small ids', async () => {
    await call(payload({ id: 1 }));
    const { eventKey } = mocks.record.mock.calls[0][0];
    expect(eventKey).toBe('chat-msg-2-1');
    expect(eventKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
  });

  it('uses a neutral notification when the customer has no name or text', async () => {
    await call(payload({ sender: null, content: null }));
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: '', preview: '' })
    );
  });

  it.each([
    'notified',
    'coalesced',
    'muted',
    'ignored',
  ])('acknowledges a %s outcome', async (outcome) => {
    mocks.record.mockResolvedValue({ ok: true, outcome, duplicate: true });
    const response = await call(payload());
    expect(response.status).toBe(200);
  });

  it.each([
    'unavailable',
    'not_configured',
  ])('asks the sender to retry when intake is %s', async (code) => {
    mocks.record.mockResolvedValue({ ok: false, code });
    const response = await call(payload());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Temporarily unavailable',
      code: 'temporarily_unavailable',
    });
  });
});
