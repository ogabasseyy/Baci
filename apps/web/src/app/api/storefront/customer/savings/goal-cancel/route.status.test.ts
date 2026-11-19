import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { PATCH } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  recovery: vi.fn(),
  identity: vi.fn(),
  submit: vi.fn(),
  status: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRecoveryRuntime: mocks.recovery,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/goal-cancel-runtime', () => ({
  submitPrimaryWalletGoalCancel: mocks.submit,
  checkPrimaryWalletGoalCancelStatus: mocks.status,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const operationId = '33333333-3333-4333-8333-333333333333';
const url = 'https://example.com/api/storefront/customer/savings/goal-cancel';
const patch = (body: unknown) =>
  PATCH(new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'u' }, supabase: {} });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.recovery.mockReturnValue({
    merchantId,
    businessId: 'business',
    providerToken: 'token',
    configuration: { integrationId: 'i', environment: 'staging' },
    reconciliationConfiguration: { integrationId: 'i' },
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'c',
    userId: 'u',
  });
});

it.each([
  'pending',
  'confirmed',
  'needs_review',
  'not_started',
])('returns the public %s status as a 200 without posting', async (status) => {
  mocks.status.mockResolvedValue({ status });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status, operationId });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('maps a released attempt to the 409 CANCEL_REJECTED POST reports', async () => {
  mocks.status.mockResolvedValue({ status: 'released' });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(409);
  const payload = await response.json();
  expect(payload.code).toBe('CANCEL_REJECTED');
  expect(payload.status).toBeUndefined();
});

it.each([
  'dispatched',
  'reserved',
  'issued',
  'reviewed',
])('never lets the internal %s state leave the route', async (status) => {
  mocks.status.mockResolvedValue({ status });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(503);
  expect((await response.json()).status).toBeUndefined();
});

it('reports an unknown attempt as not found and rejects a bad status body', async () => {
  mocks.status.mockResolvedValue({ status: 'not_found' });
  expect((await patch({ merchantId, operationId })).status).toBe(404);
  expect((await patch({ merchantId })).status).toBe(400);
});

it('keeps settling a dispatched cancel through the status check', async () => {
  mocks.status.mockResolvedValue({ status: 'confirmed' });
  expect((await patch({ merchantId, operationId })).status).toBe(200);
  expect(mocks.status).toHaveBeenCalledOnce();
});
