import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { logger } from '@/lib/logger';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  merchant: vi.fn(),
  permission: vi.fn(),
  exact: vi.fn(),
  legacy: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.auth,
  hasPermission: mocks.permission,
  getUserAccess: vi.fn(),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (value: unknown) => value,
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: { forIntegration: mocks.exact, forMerchant: mocks.legacy },
}));
vi.mock('@/lib/jumia/catalog', () => ({ getAllBrands: mocks.catalog }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { GET } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const integrationId = '22222222-2222-4222-8222-222222222222';
const fixture = [{ code: 1, name: 'Acme' }];
const request = (
  query = `merchantId=${merchantId}&integrationId=${integrationId}`
) => new NextRequest(`http://localhost/api?${query}`);
describe('brands metadata route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
    mocks.merchant.mockResolvedValue({ merchantId });
    mocks.permission.mockReturnValue(true);
    mocks.exact.mockResolvedValue({ shopId: 'exact' });
    mocks.legacy.mockResolvedValue({ shopId: 'legacy' });
    mocks.catalog.mockResolvedValue(fixture);
  });
  it('uses the explicitly authorized merchant and exact integration', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).brands).toEqual(fixture);
    expect(mocks.merchant).toHaveBeenCalledWith({}, 'user', {
      requestedMerchantId: merchantId,
    });
    expect(mocks.exact).toHaveBeenCalledWith({}, merchantId, integrationId);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('retains omitted integration compatibility through the uniquely-one factory', async () => {
    expect((await GET(request(`merchantId=${merchantId}`))).status).toBe(200);
    expect(mocks.legacy).toHaveBeenCalledWith({}, merchantId);
  });
  it('rejects a wrong tenant', async () => {
    mocks.merchant.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it('rejects view-only staff', async () => {
    mocks.permission.mockReturnValue(false);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it('rejects invalid UUIDs without business reads', async () => {
    expect((await GET(request('merchantId=wrong'))).status).toBe(400);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it('returns safe unavailable errors for an exact missing integration', async () => {
    mocks.exact.mockRejectedValue(
      new JumiaApiError(404, 'secret provider detail')
    );
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
  it('fails closed on malformed provider data', async () => {
    mocks.catalog.mockResolvedValue([{ code: 'bad' }]);
    expect((await GET(request())).status).toBe(502);
  });
  it('does not expose provider error detail', async () => {
    mocks.catalog.mockRejectedValue(new Error('secret token'));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    expect(logger.error).toHaveBeenCalledWith({
      message: 'Jumia brands metadata unavailable',
      status: 502,
      kind: 'metadata',
    });
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      'secret'
    );
  });
});
