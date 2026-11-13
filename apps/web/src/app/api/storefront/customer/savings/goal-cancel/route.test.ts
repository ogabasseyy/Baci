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
const patch = (body: unknown) =>
  PATCH(new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) }));

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
  { step: 'refund', merchantId, goalId },
  { ...submit, interestForfeitAcknowledged: 'yes' },
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

// S2 contract: cancel-to-main returns the customer's own money, so neither the
// master kill switch nor the new-money flags may trap it.
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

// The one narrow emergency exception: a cancel-only off switch.
it.each([
  ['issue', issue],
  ['submit', submit],
])('refuses new %s steps with 503 SAVINGS_UNAVAILABLE when the cancel switch is on', async (_step, body) => {
  mocks.cancelDisabled.mockReturnValue(true);
  const response = await post(body);
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('SAVINGS_UNAVAILABLE');
  expect(mocks.issue).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('keeps settling a dispatched cancel through the status check when the cancel switch is on', async () => {
  mocks.cancelDisabled.mockReturnValue(true);
  mocks.status.mockResolvedValue({ status: 'confirmed' });
  const response = await patch({ merchantId, operationId });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'confirmed', operationId });
  expect(mocks.status).toHaveBeenCalledOnce();
});

it("issues the server operation id for the customer's own goal", async () => {
  mocks.issue.mockResolvedValue({
    status: 'issued',
    operationId,
    expiresAt: 'later',
  });
  const response = await post(issue);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'issued', operationId });
  expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ goalId }));
});

// A pending issue answer carries the live attempt's id so the client polls the
// PATCH status check with it. It is never a PIN-able id: the PIN verify route
// only mints a proof for an id in the issued state (see its own test).
it('returns the live attempt to poll when a double tap issues twice', async () => {
  mocks.issue.mockResolvedValue({ status: 'pending', operationId });
  expect(await (await post(issue)).json()).toEqual({
    status: 'pending',
    operationId,
  });
});

it('tells the customer a goal with legacy funds needs a review before any PIN', async () => {
  mocks.issue.mockResolvedValue({ status: 'needs_review' });
  const response = await post(issue);
  expect(response.status).toBe(409);
  const payload = await response.json();
  expect(payload.code).toBe('GOAL_NEEDS_REVIEW');
  expect(payload.operationId).toBeUndefined();
});

it('reports busy while a contribution is in flight', async () => {
  mocks.issue.mockResolvedValue({ status: 'busy' });
  const response = await post(issue);
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('CANCEL_BUSY');
});

it('answers goal not found without issuing anything', async () => {
  mocks.owned.mockResolvedValue(false);
  expect((await post(issue)).status).toBe(404);
  expect(mocks.issue).not.toHaveBeenCalled();
});

it('lets a replay of a confirmed cancel answer confirmed after the goal is gone', async () => {
  mocks.owned.mockResolvedValue(false);
  mocks.submit.mockResolvedValue({ status: 'confirmed' });
  const response = await post(submit);
  expect(response.status).toBe(200);
  expect(mocks.owned).not.toHaveBeenCalled();
});

it('answers a submit for an attempt the server never issued as a conflict', async () => {
  mocks.submit.mockResolvedValue({ status: 'conflict' });
  const response = await post(submit);
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('CANCEL_CONFLICT');
});

it('refuses another merchant and an unresolved identity', async () => {
  mocks.recovery.mockReturnValue({ merchantId: '9'.repeat(8) });
  expect((await post(submit)).status).toBe(503);
  mocks.recovery.mockReturnValue({
    merchantId,
    businessId: 'b',
    configuration: { integrationId: 'i', environment: 'staging' },
  });
  mocks.identity.mockResolvedValue(null);
  expect((await post(submit)).status).toBe(409);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('passes the proof and the issued operation id, nothing else, to the runtime', async () => {
  mocks.submit.mockResolvedValue({ status: 'pending' });
  const response = await post(submit);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ status: 'pending', operationId });
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({ goalId, operationId, pinProof })
  );
});

it.each([
  [{ status: 'confirmed' }, 200, undefined],
  [{ status: 'pending' }, 202, undefined],
  [{ status: 'pin_refused', reason: 'missing' }, 400, 'PIN_PROOF_REQUIRED'],
  [{ status: 'pin_refused', reason: 'mismatch' }, 403, 'PIN_PROOF_REFUSED'],
  [{ status: 'released' }, 409, 'CANCEL_REJECTED'],
  [{ status: 'empty' }, 409, 'NOTHING_TO_REFUND'],
  [{ status: 'too_large' }, 409, 'AMOUNT_TOO_LARGE'],
  [{ status: 'expired' }, 409, 'CANCEL_EXPIRED'],
  [{ status: 'busy' }, 409, 'CANCEL_BUSY'],
  [{ status: 'conflict' }, 409, 'CANCEL_CONFLICT'],
  [{ status: 'needs_review' }, 409, 'GOAL_NEEDS_REVIEW'],
  [{ status: 'unavailable' }, 503, 'WALLET_UNAVAILABLE'],
])('maps %j to %i %s', async (result, status, code) => {
  mocks.submit.mockResolvedValue(result);
  const response = await post(submit);
  expect(response.status).toBe(status);
  expect((await response.json()).code).toBe(code);
});

it('hides internal errors and tells the customer to check the status', async () => {
  mocks.submit.mockRejectedValue(new Error('private database detail'));
  const response = await post(submit);
  expect(response.status).toBe(503);
  const payload = await response.json();
  expect(payload.code).toBe('CANCEL_UNAVAILABLE');
  expect(JSON.stringify(payload)).not.toContain('private');
});

it('fails closed when the recovery configuration is unavailable', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('missing');
  });
  expect((await post(submit)).status).toBe(503);
  expect(mocks.submit).not.toHaveBeenCalled();
});
