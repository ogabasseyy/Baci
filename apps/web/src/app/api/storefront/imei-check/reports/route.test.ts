import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  merchant: vi.fn(),
  customer: vi.fn(),
  range: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: m.merchant,
}));
vi.mock('@/lib/vtu-customer-resolution', () => ({
  resolveVtuCustomer: m.customer,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkImeiPollRateLimit: async () => ({ allowed: true }),
  createRateLimitResponse: () => Response.json({}, { status: 429 }),
}));
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));

import { GET } from './route';

const result = {
  imei: '490154203237518',
  device: 'iPhone 13',
  modelNumber: '',
  status: 'Unknown',
  icloud: 'Unknown',
  icloudLock: 'Unknown',
  simLock: 'Unlocked',
  blacklistStatus: 'Unknown',
  carrier: 'Unknown',
  deviceImage: '',
  score: 50,
  deviceType: 'apple',
  verdict: 'Not checked',
  verdictType: 'caution',
  rawResponse: 'private provider body',
};
beforeEach(() => {
  vi.clearAllMocks();
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: m.eq,
    order: vi.fn().mockReturnThis(),
    range: m.range,
  };
  m.eq.mockReturnValue(builder);
  m.from.mockReturnValue(builder);
  m.auth.mockResolvedValue({
    user: { id: 'user-1' },
    supabase: { from: m.from },
  });
  m.merchant.mockResolvedValue({
    success: true,
    merchant: { id: 'merchant-1' },
  });
  m.customer.mockResolvedValue({ id: 'customer-1', user_id: 'user-1' });
  m.range.mockResolvedValue({
    data: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        tier: 'simLock',
        device_category: 'smartphone',
        created_at: '2026-10-30T12:00:00Z',
        cached_response: { success: true, data: result },
      },
    ],
    error: null,
  });
});
it('reopens only owned completed cached reports with no provider or payment operation', async () => {
  const response = await GET(
    new Request(
      'https://ogabassey.com/api/storefront/imei-check/reports?page=0'
    )
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.reports[0]).toMatchObject({
    tier: 'simLock',
    device: 'smartphone',
    result: { simLock: 'Unlocked' },
  });
  expect(body.reports[0].result).not.toHaveProperty('rawResponse');
  expect(m.eq.mock.calls).toEqual(
    expect.arrayContaining([
      ['merchant_id', 'merchant-1'],
      ['customer_id', 'customer-1'],
      ['status', 'completed'],
    ])
  );
  expect(m.range).toHaveBeenCalledWith(0, 20);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
});
it('rejects unauthenticated callers before storefront or DB access', async () => {
  m.auth.mockResolvedValue({ user: null });
  expect(
    (
      await GET(
        new Request('https://ogabassey.com/api/storefront/imei-check/reports')
      )
    ).status
  ).toBe(401);
  expect(m.merchant).not.toHaveBeenCalled();
  expect(m.from).not.toHaveBeenCalled();
});
it('rejects malformed pagination before database operations', async () => {
  expect(
    (
      await GET(
        new Request(
          'https://ogabassey.com/api/storefront/imei-check/reports?page=-1'
        )
      )
    ).status
  ).toBe(400);
  expect(m.from).not.toHaveBeenCalled();
});
it('does not read when customer is not linked to this storefront', async () => {
  m.customer.mockResolvedValue(null);
  const response = await GET(
    new Request('https://ogabassey.com/api/storefront/imei-check/reports')
  );
  expect((await response.json()).reports).toEqual([]);
  expect(m.from).not.toHaveBeenCalled();
});
it('returns a safe error on database failures', async () => {
  m.range.mockResolvedValue({
    data: null,
    error: { message: 'internal secret' },
  });
  const response = await GET(
    new Request('https://ogabassey.com/api/storefront/imei-check/reports')
  );
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('internal secret');
});
it('rejects an untrusted storefront without reading reports', async () => {
  m.merchant.mockResolvedValue({
    success: false,
    status: 404,
    error: 'Not found',
  });
  expect(
    (
      await GET(
        new Request('https://unknown.example/api/storefront/imei-check/reports')
      )
    ).status
  ).toBe(404);
  expect(m.from).not.toHaveBeenCalled();
});

it('does not link or expose unlinked email-only customer matches', async () => {
  m.customer.mockResolvedValue({ id: 'customer-1', user_id: null });
  const response = await GET(
    new Request('https://ogabassey.com/api/storefront/imei-check/reports')
  );
  expect(m.customer).toHaveBeenCalledWith(
    expect.objectContaining({ linkEmailMatch: false })
  );
  expect((await response.json()).reports).toEqual([]);
  expect(m.from).not.toHaveBeenCalled();
});
