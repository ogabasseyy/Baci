import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisioningFixture } from '@/lib/piggyvest/primary-savings-provisioning.test-support';
import { handlePrimaryProvisioning } from './handle-primary-provisioning';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  features: vi.fn(),
  run: vi.fn(),
  goal: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-savings-provisioning-runtime', () => ({
  readPrimarySavingsProvisioningRuntime: mocks.runtime,
  runPrimarySavingsProvisioning: mocks.run,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock(
  '@/app/api/storefront/customer/savings/customer-savings-feature-settings',
  () => ({ getPrimaryCustomerSavingsFeatureSettings: mocks.features })
);

const base = {
  merchantId: provisioningFixture.scope.merchantId,
  goalId: provisioningFixture.goalId,
};
const goal = {
  id: base.goalId,
  merchant_id: base.merchantId,
  customer_id: provisioningFixture.scope.customerId,
  status: 'active',
  terms_accepted_at: '2026-10-07T00:00:00Z',
  non_withdrawable_accepted_at: '2026-10-07T00:00:00Z',
};
const pending = {
  status: 'pending',
  interestAccepted: false,
  interestEnrollment: 'not_requested',
  accounts: [],
};

function request(input: unknown) {
  return new NextRequest('https://example.test/api/savings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const query: Record<string, unknown> = { maybeSingle: mocks.goal };
  query.select = () => query;
  query.eq = () => query;
  mocks.auth.mockResolvedValue({
    user: { id: provisioningFixture.scope.userId },
    supabase: { from: () => query },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue(provisioningFixture.configuration);
  mocks.identity.mockResolvedValue(provisioningFixture.scope);
  mocks.features.mockResolvedValue({ savingsEnabled: true });
  mocks.goal.mockResolvedValue({ data: goal, error: null });
  mocks.run.mockResolvedValue(pending);
});

describe('handlePrimaryProvisioning', () => {
  it('passes the explicit customer choice through in setup mode', async () => {
    const response = await handlePrimaryProvisioning(
      request({ ...base, interestAccepted: true }),
      'setup'
    );
    expect(response.status).toBe(202);
    expect(mocks.runtime).toHaveBeenCalledWith(expect.anything(), 'setup');
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'setup',
        goalId: base.goalId,
        interestAccepted: true,
      })
    );
  });

  it('lets setup mode run without a choice so a stored one can be reused', async () => {
    const response = await handlePrimaryProvisioning(request(base), 'setup');
    expect(response.status).toBe(202);
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'setup', interestAccepted: undefined })
    );
  });

  it('resolves setup with the post-onboarding identity, provision with the onboarding one', async () => {
    await handlePrimaryProvisioning(
      request({ ...base, interestAccepted: true }),
      'setup'
    );
    expect(mocks.identity).toHaveBeenLastCalledWith(
      expect.objectContaining({ forOnboarding: false })
    );
    await handlePrimaryProvisioning(
      request({ ...base, consent: true, interestAccepted: true }),
      'provision'
    );
    expect(mocks.identity).toHaveBeenLastCalledWith(
      expect.objectContaining({ forOnboarding: true })
    );
  });

  it('refuses a non-boolean choice before any provisioning', async () => {
    const response = await handlePrimaryProvisioning(
      request({ ...base, interestAccepted: 'yes' }),
      'setup'
    );
    expect(response.status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('answers 400 INTEREST_CHOICE_REQUIRED when no choice is stored or sent', async () => {
    mocks.run.mockResolvedValue({ status: 'choice_required' });
    const response = await handlePrimaryProvisioning(request(base), 'setup');
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INTEREST_CHOICE_REQUIRED');
  });

  it('answers 404 SAVINGS_WALLET_NOT_FOUND when status says not started', async () => {
    mocks.run.mockResolvedValue({ status: 'not_found', goalId: base.goalId });
    const response = await handlePrimaryProvisioning(request(base), 'recover');
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('SAVINGS_WALLET_NOT_FOUND');
  });

  it('is unavailable when the runtime is not configured', async () => {
    mocks.runtime.mockReturnValue(null);
    const response = await handlePrimaryProvisioning(request(base), 'setup');
    expect(response.status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('requires an active accepted goal', async () => {
    mocks.goal.mockResolvedValue({
      data: { ...goal, status: 'closed' },
      error: null,
    });
    const response = await handlePrimaryProvisioning(request(base), 'setup');
    expect(response.status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('hides another customer goal behind a 404', async () => {
    mocks.goal.mockResolvedValue({
      data: { ...goal, customer_id: 'someone-else' },
      error: null,
    });
    const response = await handlePrimaryProvisioning(request(base), 'setup');
    expect(response.status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
