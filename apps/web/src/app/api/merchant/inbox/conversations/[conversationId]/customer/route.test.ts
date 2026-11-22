import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  get: vi.fn(),
  profile: vi.fn(),
}));

vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-client', () => ({
  getMerchantInboxConversation: mocks.get,
}));
vi.mock('@/lib/chatwoot/merchant-inbox-customer', () => ({
  loadCustomerProfile: mocks.profile,
}));

import { GET } from './route';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 };
const supabase = { marker: 'scoped' };

const call = (id: string) =>
  GET(
    new NextRequest(
      `https://app.example.test/api/merchant/inbox/conversations/${id}/customer`
    ),
    { params: Promise.resolve({ conversationId: id }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    ok: true,
    binding,
    supabase,
    merchantId: 'merchant-1',
  });
  mocks.get.mockResolvedValue({
    ok: true,
    conversation: { id: 7 },
    link: 'signed.link',
  });
  mocks.profile.mockResolvedValue({ name: 'Ada Obi', orderCount: 5 });
});

describe('GET /api/merchant/inbox/conversations/[id]/customer', () => {
  it('returns the customer behind a linked chat', async () => {
    const response = await call('7');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      customer: { name: 'Ada Obi', orderCount: 5 },
    });
    expect(mocks.get).toHaveBeenCalledWith(binding, 7);
    expect(mocks.profile).toHaveBeenCalledWith({
      supabase,
      merchantId: 'merchant-1',
      token: 'signed.link',
    });
  });

  it('returns no customer for a guest chat without reading customers', async () => {
    mocks.get.mockResolvedValue({
      ok: true,
      conversation: { id: 7 },
      link: null,
    });
    const response = await call('7');
    await expect(response.json()).resolves.toEqual({ customer: null });
    expect(mocks.profile).not.toHaveBeenCalled();
  });

  it('returns no customer when the link does not verify', async () => {
    mocks.profile.mockResolvedValue(null);
    await expect((await call('7')).json()).resolves.toEqual({ customer: null });
  });

  it('treats a chat outside the store inbox as not found', async () => {
    mocks.get.mockResolvedValue({ ok: false, code: 'not_found' });
    expect((await call('7')).status).toBe(404);
    expect(mocks.profile).not.toHaveBeenCalled();
  });

  it('answers 503 when the chat engine is unavailable', async () => {
    mocks.get.mockResolvedValue({ ok: false, code: 'unavailable' });
    expect((await call('7')).status).toBe(503);
  });

  it('rejects a bad id and answers a guest before reading input', async () => {
    expect((await call('abc')).status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();

    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'unauthorized' }, { status: 401 }),
    });
    expect((await call('abc')).status).toBe(401);
  });
});
