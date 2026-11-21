import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  read: vi.fn(),
  host: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/oxygen-mobile-capabilities-rate-limit', () => ({
  checkOxygenMobileCapabilitiesRateLimit: mocks.limit,
}));
vi.mock('@/lib/payments/oxygen/mobile-capabilities', () => ({
  readOxygenMobileCapabilities: mocks.read,
}));
vi.mock('@/lib/domain-cache-simple', () => ({
  getSlugForCustomDomain: mocks.host,
}));

import { GET } from './route';

const request = (query = 'merchantSlug=test-store', host = 'usebaci.com') =>
  new NextRequest(
    `https://${host}/api/payments/oxygen/mobile-capabilities?${query}`
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'user' },
    supabase: { rpc: vi.fn() },
  });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.read.mockResolvedValue({
    ok: true,
    capabilities: { mobileEnabled: false },
  });
  mocks.host.mockResolvedValue('test-store');
});
it('authenticates before limit, validation, and policy', async () => {
  mocks.auth.mockResolvedValue({ error: 'unauthorized' });
  expect((await GET(request('merchantSlug=invalid!'))).status).toBe(401);
  expect(mocks.limit).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each([
  'merchantSlug=INVALID',
  'merchantSlug=',
  'merchantSlug=test-store&merchantSlug=other',
  'merchantSlug=test-store&unexpected=x',
])('rejects invalid query before policy: %s', async (query) => {
  expect((await GET(request(query))).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('rate limits per user', async () => {
  mocks.limit.mockResolvedValue({ allowed: false });
  expect((await GET(request())).status).toBe(429);
  expect(mocks.limit).toHaveBeenCalledWith('user');
  expect(mocks.read).not.toHaveBeenCalled();
});
it('returns private no-store metadata even when new initiation is disabled', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ mobileEnabled: false });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toContain('Authorization');
});
it.each([
  404, 503,
])('maps policy status %s to a static error', async (status) => {
  mocks.read.mockResolvedValue({ ok: false, status });
  const response = await GET(request());
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    error:
      status === 404
        ? 'Storefront not found'
        : 'Oxygen capabilities unavailable',
  });
});
it('rejects storefront-host slug mismatch before policy', async () => {
  mocks.host.mockResolvedValue('foreign');
  expect((await GET(request(undefined, 'shop.example.test'))).status).toBe(404);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each([
  '[::1]',
  '[::1]:3000',
])('recognizes the staging loopback authority %s as a central API host', async (host) => {
  mocks.host.mockResolvedValue(null);
  const response = await GET(
    new NextRequest(
      `http://${host}/api/payments/oxygen/mobile-capabilities?merchantSlug=test-store`,
      { headers: { host } }
    )
  );
  expect(response.status).toBe(200);
  expect(mocks.host).not.toHaveBeenCalled();
});
it('pins a storefront Host header when the internal URL uses loopback', async () => {
  const response = await GET(
    new NextRequest(
      'http://[::1]:3000/api/payments/oxygen/mobile-capabilities?merchantSlug=test-store',
      { headers: { host: 'foreign.usebaci.com' } }
    )
  );
  expect(response.status).toBe(404);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('rejects a Host header with trailing text after the loopback literal', async () => {
  const response = await GET(
    new NextRequest(
      'http://[::1]:3000/api/payments/oxygen/mobile-capabilities?merchantSlug=test-store',
      { headers: { host: '[::1].example.test' } }
    )
  );
  expect(response.status).toBe(404);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('fails closed when limiter or policy throws', async () => {
  mocks.limit.mockRejectedValueOnce(new Error('secret'));
  expect((await GET(request())).status).toBe(503);
  mocks.read.mockRejectedValueOnce(new Error('secret'));
  expect((await GET(request())).status).toBe(503);
});
