import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  listMessages: vi.fn(),
  sendReply: vi.fn(),
  csrf: vi.fn(),
}));

vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-client', () => ({
  listMerchantInboxMessages: mocks.listMessages,
  sendMerchantInboxReply: mocks.sendReply,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));

import { GET, POST } from './route';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 };

function call(conversationId: string, query = '') {
  return GET(
    new NextRequest(
      `https://app.example.test/api/merchant/inbox/conversations/${conversationId}/messages${query}`
    ),
    { params: Promise.resolve({ conversationId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ ok: true, binding });
  mocks.listMessages.mockResolvedValue({
    ok: true,
    conversation: { id: 7 },
    messages: [{ id: 30 }],
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.sendReply.mockResolvedValue({ ok: true, message: { id: 45 } });
});

function reply(conversationId: string, body: unknown, raw = false) {
  return POST(
    new NextRequest(
      `https://app.example.test/api/merchant/inbox/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw ? String(body) : JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ conversationId }) }
  );
}

describe('GET /api/merchant/inbox/conversations/[conversationId]/messages', () => {
  it('returns the conversation and its messages', async () => {
    const response = await call('7', '?before=40');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversation: { id: 7 },
      messages: [{ id: 30 }],
    });
    expect(mocks.resolve).toHaveBeenCalledWith('view');
    expect(mocks.listMessages).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      before: 40,
    });
  });

  it.each([
    ['abc', ''],
    ['0', ''],
    ['-4', ''],
    ['7', '?before=x'],
  ])('rejects id %s %s before authenticating', async (id, query) => {
    const response = await call(id, query);
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('returns 404 for a conversation outside the merchant inbox', async () => {
    mocks.listMessages.mockResolvedValue({ ok: false, code: 'not_found' });
    const response = await call('7');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'not_found' });
  });

  it('returns a safe 503 when the provider is unavailable', async () => {
    mocks.listMessages.mockResolvedValue({ ok: false, code: 'unavailable' });
    const response = await call('7');
    expect(response.status).toBe(503);
  });

  it('returns the authorization failure untouched', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'unauthorized' }, { status: 401 }),
    });
    const response = await call('7');
    expect(response.status).toBe(401);
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });
});

describe('POST /api/merchant/inbox/conversations/[conversationId]/messages', () => {
  it('sends a trimmed reply with edit permission', async () => {
    const response = await reply('7', { content: '  Yes, in stock.  ' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: { id: 45 } });
    expect(mocks.resolve).toHaveBeenCalledWith('edit');
    expect(mocks.sendReply).toHaveBeenCalledWith(binding, {
      conversationId: 7,
      content: 'Yes, in stock.',
    });
  });

  it('rejects a failed CSRF check before reading anything', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    const response = await reply('7', { content: 'hello' });
    expect(response.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.sendReply).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{nope', true],
    ['empty content', { content: '   ' }, false],
    ['oversized content', { content: 'a'.repeat(2_001) }, false],
    ['an unexpected field', { content: 'hi', private: true }, false],
    ['a non-string content', { content: 5 }, false],
  ])('rejects %s as a client error', async (_label, body, raw) => {
    const response = await reply('7', body, raw);
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.sendReply).not.toHaveBeenCalled();
  });

  it('does not send for a caller without edit permission', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'forbidden' }, { status: 403 }),
    });
    const response = await reply('7', { content: 'hello' });
    expect(response.status).toBe(403);
    expect(mocks.sendReply).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404, 'not_found'],
    ['delivery_unknown', 502, 'delivery_unknown'],
    ['unavailable', 503, 'temporarily_unavailable'],
  ])('maps %s to %i', async (code, status, responseCode) => {
    mocks.sendReply.mockResolvedValue({ ok: false, code });
    const response = await reply('7', { content: 'hello' });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      code: responseCode,
    });
  });
});
