import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  merchant: vi.fn(),
  readiness: vi.fn(),
  csrf: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (value: unknown) => value,
}));
vi.mock('@/lib/store-readiness/load-store-readiness', () => ({
  loadStoreReadiness: mocks.readiness,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const preferences = {
  in_app_enabled: true,
  banner_enabled: true,
  follow_up_notifications_enabled: true,
};
function request(method = 'GET', body?: string) {
  return new NextRequest(
    `https://usebaci.com/api/merchant/onboarding-reminder?merchantId=${merchantId}`,
    {
      method,
      ...(body === undefined ? {} : { body }),
    }
  );
}

describe('owner onboarding reminder API', () => {
  const read = vi.fn();
  const upsert = vi.fn();
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: read, upsert };
  const supabase = { from: vi.fn(() => chain) };
  beforeEach(() => {
    vi.clearAllMocks();
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    read.mockResolvedValue({ data: null, error: null });
    upsert.mockResolvedValue({ error: null });
    mocks.auth.mockResolvedValue({
      user: { id: 'owner' },
      supabase,
      error: null,
    });
    mocks.merchant.mockResolvedValue({
      merchantId,
      staffAccess: { isOwner: true },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.readiness.mockResolvedValue({
      merchantId,
      surface: 'web',
      isPublished: false,
      isReady: false,
      storeBuild: { starterStoreReady: true },
      items: [
        {
          id: 'first_product',
          label: 'Publish your first product',
          description: 'Add a product',
          priority: 'required',
          completed: false,
        },
      ],
    });
  });
  it('authenticates before looking up merchants and rejects staff', async () => {
    const { GET } = await import('./route');
    mocks.auth.mockResolvedValueOnce({
      user: null,
      error: 'expired',
      supabase: null,
    });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.merchant).not.toHaveBeenCalled();
    mocks.merchant.mockResolvedValueOnce({
      merchantId,
      staffAccess: { isOwner: false },
    });
    expect((await GET(request())).status).toBe(403);
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it('returns one live action through the normal caller client', async () => {
    const { GET } = await import('./route');
    const response = await GET(request());
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      merchantId,
      reminder: { id: 'first_product' },
    });
    expect(mocks.readiness).toHaveBeenCalledWith(
      expect.objectContaining({ supabase, merchantId, surface: 'web' })
    );
  });
  it.each([
    'in_app_enabled',
    'banner_enabled',
    'follow_up_notifications_enabled',
  ])('honors %s', async (key) => {
    const { GET } = await import('./route');
    read.mockResolvedValueOnce({
      data: { ...preferences, [key]: false },
      error: null,
    });
    expect(await (await GET(request())).json()).toEqual({
      merchantId,
      reminder: null,
    });
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it.each([
    'in_app_enabled',
    'banner_enabled',
    'follow_up_notifications_enabled',
  ])('uses enabled defaults for a legacy null %s', async (key) => {
    const { GET } = await import('./route');
    read.mockResolvedValueOnce({
      data: { ...preferences, [key]: null },
      error: null,
    });
    expect(await (await GET(request())).json()).toMatchObject({
      merchantId,
      reminder: { id: 'first_product' },
    });
  });
  it('skips the full readiness load for a published store', async () => {
    const { GET } = await import('./route');
    read.mockResolvedValueOnce({ data: null, error: null });
    read.mockResolvedValueOnce({ data: null, error: null });
    read.mockResolvedValueOnce({ data: { is_published: true }, error: null });
    expect(await (await GET(request())).json()).toEqual({
      merchantId,
      reminder: null,
    });
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it('fails closed when publication status cannot be read', async () => {
    const { GET } = await import('./route');
    read.mockResolvedValueOnce({ data: null, error: null });
    read.mockResolvedValueOnce({ data: null, error: null });
    read.mockResolvedValueOnce({
      data: null,
      error: { message: 'private publication error' },
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private publication error'
    );
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it('honors durable snooze and fails closed on database errors', async () => {
    const { GET } = await import('./route');
    read.mockResolvedValueOnce({ data: preferences, error: null });
    read.mockResolvedValueOnce({
      data: { snoozed_until: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    expect(await (await GET(request())).json()).toEqual({
      merchantId,
      reminder: null,
    });
    read.mockResolvedValueOnce({
      data: null,
      error: { message: 'private database failure' },
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private database failure'
    );
  });
  it('validates merchant scope and malformed mutation input', async () => {
    const { GET, PATCH } = await import('./route');
    expect(
      (
        await GET(
          new NextRequest(
            'https://usebaci.com/api/merchant/onboarding-reminder?merchantId=bad'
          )
        )
      ).status
    ).toBe(400);
    expect((await PATCH(request('PATCH', '{'))).status).toBe(400);
    expect((await PATCH(request('PATCH', '{"action":"delete"}'))).status).toBe(
      400
    );
    expect(upsert).not.toHaveBeenCalled();
  });
  it('snoozes only the authenticated owner and rejects CSRF before mutation', async () => {
    const { PATCH } = await import('./route');
    mocks.csrf.mockResolvedValueOnce({ valid: false });
    expect((await PATCH(request('PATCH', '{"action":"snooze"}'))).status).toBe(
      403
    );
    expect(upsert).not.toHaveBeenCalled();
    const before = Date.now();
    expect((await PATCH(request('PATCH', '{"action":"snooze"}'))).status).toBe(
      200
    );
    expect(upsert).toHaveBeenCalledWith(
      {
        merchant_id: merchantId,
        user_id: 'owner',
        snoozed_until: expect.any(String),
      },
      { onConflict: 'merchant_id,user_id' }
    );
    expect(
      Date.parse(upsert.mock.calls[0][0].snoozed_until) - before
    ).toBeGreaterThanOrEqual(86400000);
  });
  it('reports failed persistence rather than claiming a snooze succeeded', async () => {
    const { PATCH } = await import('./route');
    upsert.mockResolvedValueOnce({ error: { message: 'private' } });
    expect((await PATCH(request('PATCH', '{"action":"snooze"}'))).status).toBe(
      500
    );
  });
});
