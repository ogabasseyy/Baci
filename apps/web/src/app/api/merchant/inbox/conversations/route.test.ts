import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-client', () => ({
  listMerchantInboxConversations: mocks.list,
}));

import { GET } from './route';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 };

function request(query = '') {
  return new NextRequest(
    `https://app.example.test/api/merchant/inbox/conversations${query}`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ ok: true, binding });
  mocks.list.mockResolvedValue({
    ok: true,
    conversations: [{ id: 1 }],
    hasMore: true,
  });
});

describe('GET /api/merchant/inbox/conversations', () => {
  it('lists the session merchant conversations with defaults', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversations: [{ id: 1 }],
      hasMore: true,
      page: 1,
    });
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), 'view');
    expect(mocks.list).toHaveBeenCalledWith(binding, {
      page: 1,
      status: 'all',
    });
  });

  it('accepts the snoozed filter', async () => {
    await GET(request('?status=snoozed'));
    expect(mocks.list).toHaveBeenCalledWith(binding, {
      page: 1,
      status: 'snoozed',
    });
  });

  it('passes a smart view through to the provider call', async () => {
    await GET(request('?view=needs_reply'));
    expect(mocks.list).toHaveBeenCalledWith(binding, {
      page: 1,
      status: 'all',
      view: 'needs_reply',
    });
  });

  it('passes validated paging and status', async () => {
    await GET(request('?page=3&status=open'));
    expect(mocks.list).toHaveBeenCalledWith(binding, {
      page: 3,
      status: 'open',
    });
  });

  it.each([
    '?page=0',
    '?page=abc',
    '?status=deleted',
    '?view=everything',
  ])('rejects %s for a signed-in merchant without calling the provider', async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('answers an unauthenticated caller the same for valid and invalid input', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'unauthorized' }, { status: 401 }),
    });
    expect((await GET(request('?page=abc'))).status).toBe(401);
    expect((await GET(request())).status).toBe(401);
  });

  it('returns the authorization failure untouched', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'forbidden' }, { status: 403 }),
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('hides provider failures behind a safe 503', async () => {
    mocks.list.mockResolvedValue({ ok: false, code: 'unavailable' });
    const response = await GET(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Messages are temporarily unavailable',
      code: 'temporarily_unavailable',
    });
  });
});
