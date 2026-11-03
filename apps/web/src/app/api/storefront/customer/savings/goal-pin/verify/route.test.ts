import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';

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
}));
vi.mock('@/lib/piggyvest/goal-pin-verify', () => ({
  verifyGoalPin: mocks.verify,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const proof = createHash('sha256').update('s5-route-verify').digest('hex');
const fund = {
  merchantId,
  pin: '482915',
  action: 'fund',
  goalId,
  operationId,
  amountKobo: 2000,
};
const cancel = { merchantId, pin: '482915', action: 'cancel', goalId };
function call(body: unknown) {
  return POST(
    new NextRequest(
      'https://example.com/api/storefront/customer/savings/goal-pin/verify',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    )
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'user' },
    supabase: { rpc: mocks.rpc },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({ merchantId });
  mocks.recovery.mockReturnValue({ merchantId });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'c',
    userId: 'u',
  });
  mocks.features.mockResolvedValue({ savingsEnabled: true });
  mocks.goal.mockResolvedValue(true);
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
it('keeps cancel PIN checks available through the recovery runtime when flags are off', async () => {
  mocks.runtime.mockReturnValue(null);
  expect((await call(cancel)).status).toBe(200);
  expect(mocks.verify).toHaveBeenCalledWith(
    expect.objectContaining({
      binding: expect.objectContaining({
        purpose: 'goal_cancel',
        amountKobo: 1,
      }),
    })
  );
});
it('refuses complete when the runtime is off even if recovery is on', async () => {
  mocks.runtime.mockReturnValue(null);
  expect((await call({ ...cancel, action: 'complete' })).status).toBe(503);
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
it('keeps cancel available with the feature off but only for an own active goal', async () => {
  mocks.features.mockResolvedValue({ savingsEnabled: false });
  expect((await call(cancel)).status).toBe(200);
  expect(mocks.features).not.toHaveBeenCalled();
  expect(mocks.goal).toHaveBeenCalledWith(
    expect.objectContaining({ goalId, merchantId, customerId: 'c' })
  );
});
it.each([
  cancel,
  { ...cancel, action: 'complete' },
])('issues no $action proof for a goal that is not an active goal of this customer', async (body) => {
  mocks.goal.mockResolvedValue(false);
  const response = await call(body);
  expect(response.status).toBe(404);
  expect((await response.json()).code).toBe('GOAL_NOT_FOUND');
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('gates complete proofs on the customer savings feature', async () => {
  mocks.features.mockResolvedValue({ savingsEnabled: false });
  const response = await call({ ...cancel, action: 'complete' });
  expect(response.status).toBe(403);
  expect(mocks.verify).not.toHaveBeenCalled();
});
