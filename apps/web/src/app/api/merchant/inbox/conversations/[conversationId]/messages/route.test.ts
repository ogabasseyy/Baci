import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  listMessages: vi.fn(),
}));

vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-client', () => ({
  listMerchantInboxMessages: mocks.listMessages,
}));

import { GET } from './route';

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
});

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
