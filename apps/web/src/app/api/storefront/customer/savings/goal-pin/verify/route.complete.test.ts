import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  call,
  cancel,
  complete,
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
it('returns a proof for complete bound to the goal and the server-issued operation id', async () => {
  const response = await call(complete);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    proof,
    expiresAt: '2026-11-03T12:02:00Z',
  });
  expect(mocks.verify).toHaveBeenCalledWith(
    expect.objectContaining({
      binding: {
        purpose: 'goal_complete',
        amountKobo: 1,
        idempotencyKeySha256: createHash('sha256')
          .update(`${goalId}:complete:${operationId}`)
          .digest('hex'),
      },
    })
  );
  expect(mocks.completable).toHaveBeenCalledOnce();
  expect(mocks.goal).not.toHaveBeenCalled();
  expect(mocks.cancellable).not.toHaveBeenCalled();
});
it('mints no complete proof for an operation id that is not live for this customer and goal', async () => {
  mocks.completeIssued.mockResolvedValue(false);
  const response = await call(complete);
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('COMPLETE_OPERATION_INVALID');
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.issued).not.toHaveBeenCalled();
  expect(mocks.completeIssued).toHaveBeenCalledWith(
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
it("answers goal not found for a complete of a goal that is not the customer's", async () => {
  mocks.completable.mockResolvedValue(false);
  const response = await call(complete);
  expect(response.status).toBe(404);
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.completeIssued).not.toHaveBeenCalled();
});
it('keeps complete working with the savings runtime, feature setting and flags off', async () => {
  mocks.runtime.mockReturnValue(null);
  mocks.features.mockResolvedValue({ savingsEnabled: false });
  const response = await call(complete);
  expect(response.status).toBe(200);
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.recovery).toHaveBeenCalledOnce();
  expect(mocks.features).not.toHaveBeenCalled();
});
it('fails closed when the complete live-operation check is unavailable', async () => {
  mocks.completeIssued.mockRejectedValue(new Error('database down'));
  const response = await call(complete);
  expect(response.status).toBe(503);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it('does not ask the complete store about a cancel or funding proof', async () => {
  await call(cancel);
  await call(fund);
  expect(mocks.completeIssued).not.toHaveBeenCalled();
});
