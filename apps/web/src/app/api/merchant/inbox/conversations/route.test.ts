import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  list: vi.fn(),
  badges: vi.fn(),
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
vi.mock('@/lib/chatwoot/merchant-inbox-customer', () => ({
  loadCustomerBadges: mocks.badges,
}));

import { GET } from './route';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 };
const supabase = { marker: 'scoped' };

function request(query = '') {
  return new NextRequest(
    `https://app.example.test/api/merchant/inbox/conversations${query}`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    ok: true,
    binding,
    supabase,
    merchantId: 'merchant-1',
    canViewOrders: true,
  });
  mocks.badges.mockResolvedValue({});
  mocks.list.mockResolvedValue({
    ok: true,
    conversations: [{ id: 1 }],
    hasMore: true,
    links: {},
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

  it('adds the verified customer badge to linked chats only', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      conversations: [{ id: 1 }, { id: 2 }],
      hasMore: false,
      links: { 1: 'signed.link' },
    });
    mocks.badges.mockResolvedValue({ 1: { orderCount: 5, totalSpent: 100 } });

    const response = await GET(request());
    const body = await response.json();

    expect(body.conversations).toEqual([
      { id: 1, customer: { orderCount: 5, totalSpent: 100 } },
      { id: 2 },
    ]);
    expect(mocks.badges).toHaveBeenCalledWith({
      supabase,
      merchantId: 'merchant-1',
      links: { 1: 'signed.link' },
      includeOrderData: true,
    });
    // The signed link itself never reaches the response.
    expect(JSON.stringify(body)).not.toContain('signed.link');
  });

  it('returning view keeps only customers who have ordered', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      conversations: [{ id: 1 }, { id: 2 }, { id: 3 }],
      hasMore: false,
      links: { 1: 'a', 2: 'b' },
    });
    mocks.badges.mockResolvedValue({
      1: { orderCount: 3, totalSpent: 10 },
      2: { orderCount: 0, totalSpent: 0 },
    });

    const response = await GET(request('?view=returning'));
    const body = await response.json();

    expect(body.conversations.map((c: { id: number }) => c.id)).toEqual([1]);
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
