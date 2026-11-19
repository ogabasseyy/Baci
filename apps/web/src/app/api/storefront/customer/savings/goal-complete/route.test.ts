import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { PATCH, POST } from './route';

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
  completeDisabled: vi.fn(),
}));
vi.mock('@/lib/piggyvest/piggyvest-feature-on', () => ({
  isPiggyvestFeatureOn: mocks.featureOn,
}));
vi.mock('@/lib/piggyvest/goal-complete-switch', () => ({
  isPiggyvestGoalCompleteDisabled: mocks.completeDisabled,
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
  isCompletableOwnGoal: mocks.owned,
}));
vi.mock('@/lib/piggyvest/goal-complete-runtime', () => ({
  issuePrimaryWalletGoalComplete: mocks.issue,
  submitPrimaryWalletGoalComplete: mocks.submit,
  checkPrimaryWalletGoalCompleteStatus: mocks.status,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const pinProof = createHash('sha256').update('s7-route-proof').digest('hex');
const issue = { step: 'issue', merchantId, goalId };
const submit = { step: 'submit', merchantId, goalId, operationId, pinProof };
const url = 'https://example.com/api/storefront/customer/savings/goal-complete';
const post = (body: unknown) =>
  POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown) =>
  PATCH(new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.featureOn.mockReturnValue(true);
  mocks.completeDisabled.mockReturnValue(false);
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

it('checks auth and CSRF before reading anything', async () => {
  mocks.auth.mockResolvedValue({ user: null });
  expect((await post(issue)).status).toBe(401);
  mocks.auth.mockResolvedValue({ user: { id: 'u' }, supabase: {} });
  mocks.csrf.mockResolvedValue({ valid: false });
  expect((await post(issue)).status).toBe(403);
  expect((await patch({ merchantId, operationId })).status).toBe(403);
  expect(mocks.recovery).not.toHaveBeenCalled();
  expect(mocks.issue).not.toHaveBeenCalled();
});

it.each([
  null,
  { ...issue, extra: 1 },
  { ...submit, pinProof: 'short' },
  { ...submit, pinProof: undefined },
  { step: 'submit', merchantId, goalId, pinProof },
  { step: 'complete', merchantId, goalId },
])('rejects malformed input %j', async (body) => {
  expect((await post(body)).status).toBe(400);
  expect(mocks.issue).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('reads the recovery runtime for lookups but never the gated savings runtime', async () => {
  mocks.issue.mockResolvedValue({ status: 'issued', operationId });
  expect((await post(issue)).status).toBe(200);
  expect(mocks.recovery).toHaveBeenCalledOnce();
  expect(mocks.gated).not.toHaveBeenCalled();
});

// Complete returns the customer's own money to their own main wallet, so
// neither the master kill switch nor the new-money flags may trap it.
it.each([
  ['issue', issue],
  ['submit', submit],
])('still dispatches the %s step when the kill switch and flags are off', async (_step, body) => {
  mocks.featureOn.mockReturnValue(false);
  mocks.issue.mockResolvedValue({ status: 'issued', operationId });
  mocks.submit.mockResolvedValue({ status: 'confirmed' });
  expect((await post(body)).status).toBe(200);
  expect(mocks.issue.mock.calls.length + mocks.submit.mock.calls.length).toBe(
    1
  );
});

it.each([
  ['issue', issue],
  ['submit', submit],
])('refuses new %s steps with 503 SAVINGS_UNAVAILABLE when the complete switch is on', async (_step, body) => {
  mocks.completeDisabled.mockReturnValue(true);
  const response = await post(body);
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('SAVINGS_UNAVAILABLE');
  expect(mocks.issue).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.recovery).not.toHaveBeenCalled();
});

it('keeps settling a dispatched complete through the status check when the complete switch is on', async () => {
  mocks.completeDisabled.mockReturnValue(true);
  mocks.status.mockResolvedValue({ status: 'confirmed' });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'confirmed', operationId });
});

it('answers goal not found for a goal that is not the customer to complete', async () => {
  mocks.owned.mockResolvedValue(false);
  const response = await post(issue);
  expect(response.status).toBe(404);
  expect(mocks.issue).not.toHaveBeenCalled();
});

it('refuses a request for another merchant than the configured one', async () => {
  const response = await post({
    ...issue,
    merchantId: '99999999-9999-4999-8999-999999999999',
  });
  expect(response.status).toBe(503);
  expect(mocks.issue).not.toHaveBeenCalled();
});

it.each([
  [{ status: 'issued', operationId, expiresAt: 'soon' }, 200, 'issued'],
  [{ status: 'pending', operationId }, 200, 'pending'],
  [{ status: 'confirmed', operationId }, 200, 'confirmed'],
])('returns the operation for the issue answer %j', async (answer, status, name) => {
  mocks.issue.mockResolvedValue(answer);
  const response = await post(issue);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ status: name, operationId });
});

it.each([
  [{ status: 'not_eligible' }, 409, 'COMPLETE_NOT_ELIGIBLE'],
  [{ status: 'busy' }, 409, 'COMPLETE_BUSY'],
  [{ status: 'needs_review' }, 409, 'GOAL_NEEDS_REVIEW'],
])('refuses the issue answer %j with %i %s', async (answer, status, code) => {
  mocks.issue.mockResolvedValue(answer);
  const response = await post(issue);
  expect(response.status).toBe(status);
  expect((await response.json()).code).toBe(code);
});

it('turns an issue failure into a safe 503 without database detail', async () => {
  mocks.issue.mockRejectedValue(new Error('private database detail'));
  const response = await post(issue);
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private');
});

it('submits with the operation id and PIN proof and answers confirmed', async () => {
  mocks.submit.mockResolvedValue({ status: 'confirmed' });
  const response = await post(submit);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'confirmed', operationId });
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({ goalId, operationId, pinProof })
  );
});

it('answers pending with 202 after a send that is not yet settled', async () => {
  mocks.submit.mockResolvedValue({ status: 'pending' });
  const response = await post(submit);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ status: 'pending', operationId });
});

it.each([
  [{ status: 'pin_refused', reason: 'missing' }, 400, 'PIN_PROOF_REQUIRED'],
  [{ status: 'pin_refused', reason: 'mismatch' }, 403, 'PIN_PROOF_REFUSED'],
  [{ status: 'released' }, 409, 'COMPLETE_REJECTED'],
  [{ status: 'empty' }, 409, 'NOTHING_TO_MOVE'],
  [{ status: 'too_large' }, 409, 'AMOUNT_TOO_LARGE'],
  [{ status: 'expired' }, 409, 'COMPLETE_EXPIRED'],
  [{ status: 'needs_review' }, 409, 'GOAL_NEEDS_REVIEW'],
  [{ status: 'busy' }, 409, 'COMPLETE_BUSY'],
  [{ status: 'not_eligible' }, 409, 'COMPLETE_NOT_ELIGIBLE'],
  [{ status: 'unavailable' }, 503, 'WALLET_UNAVAILABLE'],
  [{ status: 'conflict' }, 409, 'COMPLETE_CONFLICT'],
])('maps the submit answer %j to %i %s', async (answer, status, code) => {
  mocks.submit.mockResolvedValue(answer);
  const response = await post(submit);
  expect(response.status).toBe(status);
  expect((await response.json()).code).toBe(code);
});

it('hides submit failures behind a status-check message', async () => {
  mocks.submit.mockRejectedValue(new Error('private database detail'));
  const response = await post(submit);
  expect(response.status).toBe(503);
  const payload = await response.json();
  expect(payload.code).toBe('COMPLETE_UNAVAILABLE');
  expect(JSON.stringify(payload)).not.toContain('private');
});
