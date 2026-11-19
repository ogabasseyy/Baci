import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), insights: vi.fn() }));

vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-insights', () => ({
  getMerchantInboxInsights: mocks.insights,
}));

import { GET } from './route';

const binding = { merchantId: 'm', accountId: 2, inboxId: 20 };
const get = (query = '') =>
  GET(
    new NextRequest(
      `https://app.example.test/api/merchant/inbox/insights${query}`
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ ok: true, binding });
  mocks.insights.mockResolvedValue({
    ok: true,
    insights: { days: 7, conversations: 3 },
  });
});

describe('GET /api/merchant/inbox/insights', () => {
  it('returns the session merchant insights for the default window', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(mocks.insights).toHaveBeenCalledWith(binding, { days: 7 });
  });

  it('returns the auth response without calling the provider', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'unauthorized' }, { status: 401 }),
    });
    expect((await get()).status).toBe(401);
    expect(mocks.insights).not.toHaveBeenCalled();
  });

  it('rejects an unsupported window with 400', async () => {
    expect((await get('?days=365')).status).toBe(400);
    expect(mocks.insights).not.toHaveBeenCalled();
  });

  it('returns 503 when the provider is unavailable', async () => {
    mocks.insights.mockResolvedValue({ ok: false });
    const response = await get();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'temporarily_unavailable',
    });
  });
});
