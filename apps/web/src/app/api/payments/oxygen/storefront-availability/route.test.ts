import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  rpc: vi.fn(),
  environment: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: mocks.limit,
}));
vi.mock('@/lib/payments/oxygen/environment', () => ({
  resolveOxygenEnvironment: mocks.environment,
}));

import { GET } from './route';

const merchantId = 'f1ab0000-0000-4000-8000-000000000011';
const request = (query = `?merchantId=${merchantId}`) =>
  new NextRequest(
    `https://example.com/api/payments/oxygen/storefront-availability${query}`
  );

describe('Oxygen storefront availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: 'customer' },
      supabase: { rpc: mocks.rpc },
      error: null,
    });
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.environment.mockReturnValue('production');
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('returns only the current customer’s admitted availability', async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ available: true });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'oxygen_storefront_pilot_available',
      { p_merchant_id: merchantId }
    );
  });
  it('rejects unauthenticated and malformed requests', async () => {
    mocks.auth.mockResolvedValueOnce({ error: 'unauthorized' });
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('?merchantId=invalid'))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('fails closed when runtime is disabled or admission lookup fails', async () => {
    vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'false');
    expect(await (await GET(request())).json()).toEqual({ available: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'true');
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'unavailable' },
    });
    expect((await GET(request())).status).toBe(503);
  });
  it('limits each authenticated user and fails closed if the limiter is unavailable', async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false });
    expect((await GET(request())).status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith(
      'customer',
      'storefront-availability',
      30
    );
    mocks.limit.mockRejectedValueOnce(new Error('rate limiter offline'));
    expect((await GET(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('never enables a staging environment and prevents shared response caching', async () => {
    mocks.environment.mockReturnValueOnce('staging');
    const response = await GET(request());
    expect(await response.json()).toEqual({ available: false });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
