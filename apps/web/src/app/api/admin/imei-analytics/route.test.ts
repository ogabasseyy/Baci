import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  client: vi.fn(),
}));
vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: mocks.auth,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));

import { GET } from './route';

const analytics = {
  generatedAt: '2026-10-25T12:00:00Z',
  summary: {
    requests: 3,
    completed: 2,
    uniqueDevices: 1,
    unidentified: 0,
    matchedImages: 2,
  },
  topModels: [
    { brand: 'Apple', model: 'iPhone 17 Pro Max', checks: 2, uniqueDevices: 1 },
  ],
  topVariants: [],
  topBrands: [],
  services: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.auth.mockResolvedValue({ status: 'authenticated' });
  mocks.rpc.mockResolvedValue({ data: analytics, error: null });
});
describe('admin IMEI analytics', () => {
  it('rejects unauthenticated requests before accessing analytics', async () => {
    mocks.auth.mockResolvedValue({ status: 'unauthenticated' });
    expect(
      (await GET(new Request('https://example.com/api/admin/imei-analytics')))
        .status
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects callers without analytics permission', async () => {
    mocks.auth.mockResolvedValue({ status: 'forbidden' });
    expect(
      (await GET(new Request('https://example.com/api/admin/imei-analytics')))
        .status
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('validates query input', async () => {
    expect(
      (
        await GET(
          new Request(
            'https://example.com/api/admin/imei-analytics?period=forever'
          )
        )
      ).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses the permission-gated aggregate with merchant and period filters', async () => {
    const response = await GET(
      new Request(
        'https://example.com/api/admin/imei-analytics?period=7d&merchantSlug=ogabassey'
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith('analytics.read');
    expect(mocks.rpc).toHaveBeenCalledWith('get_admin_imei_check_analytics', {
      p_period: '7d',
      p_merchant_slug: 'ogabassey',
    });
    expect(await response.json()).toEqual(analytics);
  });
  it('does not replace an unavailable aggregate with zeros', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'private detail' },
    });
    const response = await GET(
      new Request('https://example.com/api/admin/imei-analytics')
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private detail'
    );
  });
});
