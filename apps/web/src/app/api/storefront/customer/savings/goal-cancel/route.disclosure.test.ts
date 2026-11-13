// The interest-forfeit disclosure gate (owner decision 2026-11-12): only an
// app that showed the forfeit may submit a cancel.
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  recovery: vi.fn(),
  identity: vi.fn(),
  owned: vi.fn(),
  issue: vi.fn(),
  submit: vi.fn(),
  status: vi.fn(),
  gated: vi.fn(),
  featureOn: vi.fn(),
  cancelDisabled: vi.fn(),
}));
vi.mock('@/lib/piggyvest/piggyvest-feature-on', () => ({
  isPiggyvestFeatureOn: mocks.featureOn,
}));
vi.mock('@/lib/piggyvest/goal-cancel-switch', () => ({
  isPiggyvestGoalCancelDisabled: mocks.cancelDisabled,
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRecoveryRuntime: mocks.recovery,
  readPrimaryWalletSavingsRuntime: mocks.gated,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/goal-pin-fund-eligibility', () => ({
  isCancellableOwnGoal: mocks.owned,
}));
vi.mock('@/lib/piggyvest/goal-cancel-runtime', () => ({
  issuePrimaryWalletGoalCancel: mocks.issue,
  submitPrimaryWalletGoalCancel: mocks.submit,
  checkPrimaryWalletGoalCancelStatus: mocks.status,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const pinProof = createHash('sha256').update('s6-route-proof').digest('hex');
const issue = { step: 'issue', merchantId, goalId };
const submit = {
  step: 'submit',
  merchantId,
  goalId,
  operationId,
  pinProof,
  interestForfeitAcknowledged: true,
};
const url = 'https://example.com/api/storefront/customer/savings/goal-cancel';
const post = (body: unknown) =>
  POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.featureOn.mockReturnValue(true);
  mocks.cancelDisabled.mockReturnValue(false);
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
  mocks.owned.mockResolvedValue(true);
});

describe('bugfix: an app that never showed the interest forfeit could still cancel', () => {
  it.each([
    ['missing', undefined],
    ['false', false],
  ])('refuses a submit with the acknowledgement %s, moving nothing', async (_why, value) => {
    const response = await post({
      ...submit,
      interestForfeitAcknowledged: value,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Please update the app to cancel this goal.',
      code: 'APP_UPDATE_REQUIRED',
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.recovery).not.toHaveBeenCalled();
  });

  it('proceeds as before when the app acknowledged the forfeit', async () => {
    mocks.submit.mockResolvedValue({ status: 'confirmed' });
    expect((await post(submit)).status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it('accepts the acknowledgement on the issue step too', async () => {
    mocks.issue.mockResolvedValue({ status: 'issued', operationId });
    expect(
      (await post({ ...issue, interestForfeitAcknowledged: true })).status
    ).toBe(200);
  });
});
