import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { PATCH } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  recovery: vi.fn(),
  identity: vi.fn(),
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
vi.mock('@/lib/piggyvest/goal-pin-fund-eligibility', () => ({
  isCompletableOwnGoal: vi.fn(),
}));
vi.mock('@/lib/piggyvest/goal-complete-switch', () => ({
  isPiggyvestGoalCompleteDisabled: () => false,
}));
vi.mock('@/lib/piggyvest/goal-complete-runtime', () => ({
  issuePrimaryWalletGoalComplete: vi.fn(),
  submitPrimaryWalletGoalComplete: vi.fn(),
  checkPrimaryWalletGoalCompleteStatus: mocks.status,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const operationId = '33333333-3333-4333-8333-333333333333';
const patch = (body: unknown) =>
  PATCH(
    new NextRequest(
      'https://example.com/api/storefront/customer/savings/goal-complete',
      { method: 'PATCH', body: JSON.stringify(body) }
    )
  );

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
])('answers the public status %s with 200', async (status) => {
  mocks.status.mockResolvedValue({ status });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status, operationId });
});

it('answers 404 for an unknown attempt', async () => {
  mocks.status.mockResolvedValue({ status: 'not_found' });
  expect((await patch({ merchantId, operationId })).status).toBe(404);
});

it('maps a released attempt to the same 409 rejection the submit step reports', async () => {
  mocks.status.mockResolvedValue({ status: 'released' });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('COMPLETE_REJECTED');
});

it('never returns an internal state name to the customer', async () => {
  mocks.status.mockResolvedValue({ status: 'dispatched' });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('dispatched');
});

it('rejects a malformed status request and a failing status check safely', async () => {
  expect((await patch({ merchantId })).status).toBe(400);
  mocks.status.mockRejectedValue(new Error('private detail'));
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private');
});
