import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH, POST } from './route';

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
vi.mock('@/lib/piggyvest/goal-cancel-switch', () => ({
  isPiggyvestGoalCancelDisabled: () => false,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const operationId = '33333333-3333-4333-8333-333333333333';
const url = 'https://example.com/api/storefront/customer/savings/goal-cancel';
const patch = (body: unknown) =>
  PATCH(new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) }));
const post = (body: unknown) =>
  POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }));
const goalId = '22222222-2222-4222-8222-222222222222';
const pinProof = 'a'.repeat(64);
const amounts = { principalKobo: 250000, forfeitedInterestKobo: 12000 };

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

describe('bugfix: the app guessed what an early cancel refunds', () => {
  it.each([
    'pending',
    'confirmed',
    'needs_review',
  ])('a %s status check carries the server split', async (status) => {
    mocks.status.mockResolvedValue({ status, amounts });
    const response = await patch({ merchantId, operationId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status,
      operationId,
      principalKobo: 250000,
      forfeitedInterestKobo: 12000,
    });
  });

  it.each([
    ['confirmed', 200],
    ['pending', 202],
  ] as const)('a %s submit carries the server split', async (status, code) => {
    mocks.submit.mockResolvedValue({ status, amounts });
    const response = await post({
      step: 'submit',
      merchantId,
      goalId,
      operationId,
      pinProof,
    });
    expect(response.status).toBe(code);
    expect(await response.json()).toEqual({
      status,
      operationId,
      principalKobo: 250000,
      forfeitedInterestKobo: 12000,
    });
  });
});

it('omits the split when the server has none (before dispatch or an older attempt)', async () => {
  mocks.status.mockResolvedValue({ status: 'not_started' });
  const response = await patch({ merchantId, operationId });
  expect(await response.json()).toEqual({ status: 'not_started', operationId });
});

it('answers a cancel that owes interest with no interest wallet as a temporary outage', async () => {
  mocks.submit.mockResolvedValue({ status: 'unavailable' });
  const response = await post({
    step: 'submit',
    merchantId,
    goalId,
    operationId,
    pinProof,
  });
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('WALLET_UNAVAILABLE');
});
