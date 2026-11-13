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
  issue: vi.fn(),
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
  issuePrimaryWalletGoalCancel: mocks.issue,
}));
vi.mock('@/lib/piggyvest/goal-pin-fund-eligibility', () => ({
  isCancellableOwnGoal: async () => true,
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
  // Not under review: the runtime attaches no amounts then (the money moved
  // but our books refused to settle it), so nothing is shown as back.
  it('a needs_review status check carries no split', async () => {
    mocks.status.mockResolvedValue({ status: 'needs_review' });
    expect(await (await patch({ merchantId, operationId })).json()).toEqual({
      status: 'needs_review',
      operationId,
    });
  });

  it.each([
    'pending',
    'confirmed',
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
      interestForfeitAcknowledged: true,
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
    interestForfeitAcknowledged: true,
  });
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('WALLET_UNAVAILABLE');
});

describe('bugfix: a cancel refused for a missing interest wallet read as a PiggyVest rejection', () => {
  it('a status check of a released attempt says nothing was sent, without blaming PiggyVest', async () => {
    // A split refused before anything moved (no interest wallet configured)
    // and a real provider rejection both end released with savings unchanged.
    mocks.status.mockResolvedValue({ status: 'released' });
    const response = await patch({ merchantId, operationId });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe('CANCEL_REJECTED');
    expect(payload.error).toBe(
      'This cancellation did not go through. Nothing was moved and your savings are unchanged.'
    );
    expect(payload.error).not.toMatch(/PiggyVest/);
    // Regression: never invites a retry the hold would refuse.
    expect(payload.error).not.toMatch(/try again/i);
  });
});

describe('bugfix: cancelling a goal whose PiggyVest setup never finished answered a false 503', () => {
  it('says honestly that there is nothing to cancel yet', async () => {
    mocks.issue.mockResolvedValue({ status: 'not_set_up' });
    const response = await post({ step: 'issue', merchantId, goalId });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "This plan is still being set up, so there's nothing to cancel yet.",
      code: 'GOAL_NOT_SET_UP',
    });
  });
});
