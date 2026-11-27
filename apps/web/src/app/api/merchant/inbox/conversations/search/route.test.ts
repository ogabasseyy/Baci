import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), search: vi.fn() }));

vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-search-client', () => ({
  searchMerchantInboxConversations: mocks.search,
}));

import { GET } from './route';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 };
const call = (query: string) =>
  GET(
    new NextRequest(
      `https://app.example.test/api/merchant/inbox/conversations/search${query}`
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ ok: true, binding });
  mocks.search.mockResolvedValue({
    ok: true,
    results: [{ conversation: { id: 1 }, snippet: 'hi' }],
    hasMore: false,
  });
});

describe('GET /api/merchant/inbox/conversations/search', () => {
  it('searches the session merchant inbox with a trimmed query', async () => {
    const response = await call('?q=%20order%20');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ conversation: { id: 1 }, snippet: 'hi' }],
      hasMore: false,
      page: 1,
    });
    expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), 'view');
    expect(mocks.search).toHaveBeenCalledWith(binding, { q: 'order', page: 1 });
  });

  it.each([
    '',
    '?q=a',
    `?q=${'x'.repeat(101)}`,
    '?q=ok&page=0',
  ])('rejects %s without calling the provider', async (query) => {
    expect((await call(query)).status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('answers an unauthenticated caller before reading input', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'unauthorized' }, { status: 401 }),
    });
    expect((await call('?q=')).status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('answers 503 when search is unavailable', async () => {
    mocks.search.mockResolvedValue({ ok: false, code: 'unavailable' });
    expect((await call('?q=order')).status).toBe(503);
  });
});
