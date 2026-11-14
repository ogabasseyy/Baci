import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';

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
  features: vi.fn(),
  goal: vi.fn(),
  cancellable: vi.fn(),
  issued: vi.fn(),
  cancelDisabled: vi.fn(),
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
}));
vi.mock('@/lib/piggyvest/goal-cancel-runtime', () => ({
  isPrimaryWalletGoalCancelIssued: mocks.issued,
}));
vi.mock('@/lib/piggyvest/goal-cancel-switch', () => ({
  isPiggyvestGoalCancelDisabled: mocks.cancelDisabled,
}));
vi.mock('@/lib/piggyvest/goal-pin-verify', () => ({
  verifyGoalPin: mocks.verify,
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const proof = createHash('sha256').update('s6-switch-verify').digest('hex');
const fund = {
  merchantId,
  pin: '482915',
  action: 'fund',
  goalId,
  operationId,
  amountKobo: 2000,
};
const cancel = {
  merchantId,
  pin: '482915',
  action: 'cancel',
  goalId,
  operationId,
};
const call = (body: unknown) =>
  POST(
    new NextRequest(
      'https://example.com/api/storefront/customer/savings/goal-pin/verify',
      { method: 'POST', body: JSON.stringify(body) }
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({ merchantId });
  mocks.recovery.mockReturnValue({
    merchantId,
    businessId: 'business',
    configuration: { integrationId: 'integration', environment: 'staging' },
  });
  mocks.issued.mockResolvedValue(true);
  mocks.cancelDisabled.mockReturnValue(false);
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

it('counts no PIN attempt and mints no cancel proof while the cancel switch is on', async () => {
  mocks.cancelDisabled.mockReturnValue(true);
  const response = await call(cancel);
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('SAVINGS_UNAVAILABLE');
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.issued).not.toHaveBeenCalled();
});
it('leaves funding PIN checks alone while the cancel switch is on', async () => {
  mocks.cancelDisabled.mockReturnValue(true);
  expect((await call(fund)).status).toBe(200);
  expect(mocks.verify).toHaveBeenCalledTimes(1);
});
