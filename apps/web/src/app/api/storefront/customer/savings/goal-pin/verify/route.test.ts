import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  call,
  cancel,
  fund,
  goalId,
  merchantId,
  operationId,
  proof,
} from './route.test-support';

vi.mock('@/lib/wallet-pin/wallet-pin-customer-limit', () => ({
  chargeWalletPinCustomerLimit: async () => null,
}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  recovery: vi.fn(),
  identity: vi.fn(),
  verify: vi.fn(),
  rpc: vi.fn(),
  features: vi.fn(),
  goal: vi.fn(),
  cancellable: vi.fn(),
  completable: vi.fn(),
  issued: vi.fn(),
  completeIssued: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRuntime: mocks.runtime,
  readPrimaryWalletSavingsRecoveryRuntime: mocks.recovery,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock(
  '@/app/api/storefront/customer/savings/customer-savings-feature-settings',
  () => ({ getPrimaryCustomerSavingsFeatureSettings: mocks.features })
);
vi.mock('@/lib/piggyvest/goal-pin-fund-eligibility', () => ({
  isActiveOwnGoal: mocks.goal,
  isCancellableOwnGoal: mocks.cancellable,
  isCompletableOwnGoal: mocks.completable,
}));
vi.mock('@/lib/piggyvest/goal-cancel-runtime', () => ({
  isPrimaryWalletGoalCancelIssued: mocks.issued,
}));
vi.mock('@/lib/piggyvest/goal-complete-runtime', () => ({
  isPrimaryWalletGoalCompleteIssued: mocks.completeIssued,
}));
vi.mock('@/lib/piggyvest/goal-pin-verify', () => ({
  verifyGoalPin: mocks.verify,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'user' },
    supabase: { rpc: mocks.rpc },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({ merchantId });
  mocks.recovery.mockReturnValue({
    merchantId,
    businessId: 'business',
    configuration: { integrationId: 'integration', environment: 'staging' },
  });
  mocks.issued.mockResolvedValue(true);
  mocks.completeIssued.mockResolvedValue(true);
  mocks.completable.mockResolvedValue(true);
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'c',
    userId: 'u',
  });
  mocks.features.mockResolvedValue({ savingsEnabled: true });
  mocks.goal.mockResolvedValue(true);
  mocks.cancellable.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({
    status: 'verified',
    proof,
    expiresAt: '2026-11-03T12:02:00Z',
  });
});

it('checks auth and CSRF before reading anything', async () => {
  mocks.auth.mockResolvedValue({ user: null });
  expect((await call(fund)).status).toBe(401);
  mocks.auth.mockResolvedValue({ user: { id: 'u' }, supabase: {} });
  mocks.csrf.mockResolvedValue({ valid: false });
  expect((await call(fund)).status).toBe(403);
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
});
it.each([
  null,
  { ...fund, pin: '12' },
  { ...fund, pin: 'abcd' },
  { ...fund, amountKobo: 0 },
  { ...fund, extra: 1 },
  { ...cancel, amountKobo: 5 },
  { merchantId, pin: '482915', action: 'cancel', goalId },
  { merchantId, pin: '482915', action: 'complete', goalId },
  { merchantId, pin: '1234', action: 'spend', goalId },
])('rejects malformed input %j before any check', async (body) => {
  expect((await call(body)).status).toBe(400);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('returns the proof for a correct funding PIN bound to the exact amount', async () => {
  const response = await call(fund);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    proof,
    expiresAt: '2026-11-03T12:02:00Z',
  });
  expect(mocks.verify).toHaveBeenCalledWith(
    expect.objectContaining({
      merchantId,
      pin: '482915',
      binding: expect.objectContaining({
        purpose: 'goal_fund',
        amountKobo: 2000,
      }),
    })
  );
});
it('fails closed for funding when the savings runtime is off', async () => {
  mocks.runtime.mockReturnValue(null);
  const response = await call(fund);
  expect(response.status).toBe(503);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('returns a proof for cancel bound to the goal and the server-issued operation id', async () => {
  const response = await call(cancel);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    proof,
    expiresAt: '2026-11-03T12:02:00Z',
  });
  expect(mocks.verify).toHaveBeenCalledWith(
    expect.objectContaining({
      binding: {
        purpose: 'goal_cancel',
        amountKobo: 1,
        idempotencyKeySha256: createHash('sha256')
          .update(`${goalId}:cancel:${operationId}`)
          .digest('hex'),
      },
    })
  );
  expect(mocks.cancellable).toHaveBeenCalledOnce();
  expect(mocks.goal).not.toHaveBeenCalled();
});
it('mints no cancel proof for an operation id that is not live for this customer and goal', async () => {
  mocks.issued.mockResolvedValue(false);
  const response = await call(cancel);
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('CANCEL_OPERATION_INVALID');
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.issued).toHaveBeenCalledWith(
    expect.objectContaining({
      goalId,
      operationId,
      scope: expect.objectContaining({
        customerId: 'c',
        merchantId,
        integrationId: 'integration',
      }),
    })
  );
});
it('does not ask the cancel store about a funding proof', async () => {
  await call(fund);
  expect(mocks.issued).not.toHaveBeenCalled();
});
it('fails closed when the live-operation check is unavailable', async () => {
  mocks.issued.mockRejectedValue(new Error('database down'));
  const response = await call(cancel);
  expect(response.status).toBe(503);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('keeps cancel working with the savings runtime, feature setting and flags off', async () => {
  mocks.runtime.mockReturnValue(null);
  mocks.features.mockResolvedValue({ savingsEnabled: false });
  const response = await call(cancel);
  expect(response.status).toBe(200);
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.recovery).toHaveBeenCalledOnce();
  expect(mocks.features).not.toHaveBeenCalled();
});
it("answers goal not found for a cancel of a goal that is not the customer's", async () => {
  mocks.cancellable.mockResolvedValue(false);
  const response = await call(cancel);
  expect(response.status).toBe(404);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('fails closed for cancel when the recovery configuration is unavailable', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('missing configuration');
  });
  const response = await call(cancel);
  expect(response.status).toBe(503);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('refuses a request for a different merchant than the configured one', async () => {
  mocks.runtime.mockReturnValue({
    merchantId: '99999999-9999-4999-8999-999999999999',
  });
  expect((await call(fund)).status).toBe(503);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('asks for profile verification when no identity resolves', async () => {
  mocks.identity.mockResolvedValue(null);
  expect((await call(fund)).status).toBe(409);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it.each([
  [{ status: 'incorrect', attemptsRemaining: 3 }, 401, 'PIN_INCORRECT'],
  [
    { status: 'locked', lockedUntil: '2026-11-03T12:30:00Z' },
    423,
    'PIN_LOCKED',
  ],
  [{ status: 'not_set' }, 409, 'PIN_NOT_SET'],
  [{ status: 'reset_required' }, 409, 'PIN_RESET_REQUIRED'],
  [{ status: 'too_many_proofs' }, 429, 'PIN_BUSY'],
  [{ status: 'unavailable' }, 503, 'PIN_UNAVAILABLE'],
])('maps %j to %i %s and never returns a proof', async (result, status, code) => {
  mocks.verify.mockResolvedValue(result);
  const response = await call(fund);
  expect(response.status).toBe(status);
  const payload = await response.json();
  expect(payload.code).toBe(code);
  expect(payload.proof).toBeUndefined();
  expect(JSON.stringify(payload)).not.toContain('482915');
});
it('reports attempts left and the lock time to the customer', async () => {
  mocks.verify.mockResolvedValue({ status: 'incorrect', attemptsRemaining: 3 });
  expect(await (await call(fund)).json()).toMatchObject({
    attemptsRemaining: 3,
  });
  mocks.verify.mockResolvedValue({
    status: 'locked',
    lockedUntil: '2026-11-03T12:30:00Z',
  });
  expect(await (await call(fund)).json()).toMatchObject({
    lockedUntil: '2026-11-03T12:30:00Z',
  });
});
it('hides internal errors and answers unavailable', async () => {
  mocks.verify.mockRejectedValue(new Error('private database detail'));
  const response = await call(fund);
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private');
});
it('issues no funding proof when the customer savings feature is off', async () => {
  mocks.features.mockResolvedValue({ savingsEnabled: false });
  const response = await call(fund);
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe('CUSTOMER_SAVINGS_DISABLED');
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('issues no funding proof for a goal that is not an active goal of this customer', async () => {
  mocks.goal.mockResolvedValue(false);
  const response = await call(fund);
  expect(response.status).toBe(404);
  expect((await response.json()).code).toBe('GOAL_NOT_FOUND');
  expect(mocks.goal).toHaveBeenCalledWith(
    expect.objectContaining({ goalId, merchantId, customerId: 'c' })
  );
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('answers unavailable when the goal lookup fails', async () => {
  mocks.goal.mockRejectedValue(new Error('db'));
  expect((await call(fund)).status).toBe(503);
  expect(mocks.verify).not.toHaveBeenCalled();
});
