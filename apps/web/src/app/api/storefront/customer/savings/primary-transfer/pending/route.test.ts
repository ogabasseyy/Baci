import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  recover: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/piggyvest/primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/primary-wallet-savings-recovery-runtime', () => ({
  recoverPrimaryWalletSavings: mocks.recover,
}));
const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const request = (extra = '') =>
  new NextRequest(
    `https://example.com/api/storefront/customer/savings/primary-transfer/pending?merchantId=${merchantId}&goalId=${goalId}${extra}`
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  mocks.runtime.mockReturnValue({
    merchantId,
    businessId: 'business',
    configuration: { integrationId: 'integration', environment: 'staging' },
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'customer',
    userId: 'user',
  });
  mocks.recover.mockResolvedValue(null);
});
it('checks authentication before recovery', async () => {
  mocks.auth.mockResolvedValue({ user: null });
  expect((await GET(request())).status).toBe(401);
  expect(mocks.runtime).not.toHaveBeenCalled();
});
it('rejects customer overrides and duplicate query parameters', async () => {
  expect((await GET(request('&customerId=foreign'))).status).toBe(400);
  expect((await GET(request(`&goalId=${goalId}`))).status).toBe(400);
  expect(mocks.recover).not.toHaveBeenCalled();
});
it('recovers only the authenticated customer and disables caching', async () => {
  const response = await GET(request());
  expect(await response.json()).toEqual({ operation: null });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(mocks.recover).toHaveBeenCalledWith(
    expect.objectContaining({
      goalId,
      scope: expect.objectContaining({
        customerId: 'customer',
        userId: 'user',
      }),
    })
  );
});
it('returns a friendly unavailable state without leaking storage errors', async () => {
  mocks.recover.mockRejectedValue(new Error('private database details'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private');
});
