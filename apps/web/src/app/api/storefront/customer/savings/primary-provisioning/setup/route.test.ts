import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { provisioningFixture } from '@/lib/piggyvest/primary-savings-provisioning.test-support';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  features: vi.fn(),
  run: vi.fn(),
  goal: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
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
const body = {
  merchantId: provisioningFixture.scope.merchantId,
  goalId: provisioningFixture.goalId,
};
const goal = {
  id: body.goalId,
  merchant_id: body.merchantId,
  customer_id: provisioningFixture.scope.customerId,
  status: 'active',
  terms_accepted_at: '2026-10-07T00:00:00Z',
  non_withdrawable_accepted_at: '2026-10-07T00:00:00Z',
};
const pending = {
  goalId: body.goalId,
  status: 'pending',
  interestAccepted: true,
  interestEnrollment: 'requested',
  accounts: [],
};
function request(input: unknown = body) {
  return new NextRequest('https://example.test/setup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.goal };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.auth.mockResolvedValue({
    user: { id: provisioningFixture.scope.userId },
    supabase: { from: mocks.from },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue(provisioningFixture.configuration);
  mocks.identity.mockResolvedValue(provisioningFixture.scope);
  mocks.features.mockResolvedValue({ savingsEnabled: true });
  mocks.goal.mockResolvedValue({ data: goal, error: null });
  mocks.run.mockResolvedValue(pending);
});
it('authenticates before CSRF, configuration or database access', async () => {
  mocks.auth.mockResolvedValue({ user: null });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.csrf).not.toHaveBeenCalled();
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});
it('requires CSRF', async () => {
  mocks.csrf.mockResolvedValue({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  { interestAccepted: 'true' },
  { interestAccepted: null },
  { enableInterestAccrual: true },
  { customerId: 'foreign' },
  { providerWalletId: 'foreign' },
])('rejects untrusted setup input %j', async (change) => {
  expect((await POST(request({ ...body, ...change }))).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it('is unavailable, with no database access, while provisioning is switched off', async () => {
  mocks.runtime.mockReturnValue(null);
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(mocks.runtime).toHaveBeenCalledWith(expect.anything(), 'setup');
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it("refuses a goal that is not the caller's active accepted goal", async () => {
  mocks.goal.mockResolvedValue({
    data: { ...goal, status: 'cancelled' },
    error: null,
  });
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(mocks.run).not.toHaveBeenCalled();
});
it('passes no choice when the client sends none, leaving the stored one to decide', async () => {
  const response = await POST(request());
  expect(response.status).toBe(202);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ mode: 'setup', goalId: body.goalId })
  );
  expect(mocks.run.mock.calls[0][0].interestAccepted).toBeUndefined();
});
it.each([
  true,
  false,
])('passes the explicit customer choice (%s) through', async (choice) => {
  await POST(request({ ...body, interestAccepted: choice }));
  expect(mocks.run.mock.calls[0][0].interestAccepted).toBe(choice);
});
it('answers a missing choice with a safe client error', async () => {
  mocks.run.mockResolvedValue({ ...pending, status: 'choice_required' });
  const response = await POST(request());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: 'Choose whether this goal should earn interest.',
    code: 'INTEREST_CHOICE_REQUIRED',
  });
});
it('answers a contradicted stored choice as a conflict', async () => {
  mocks.run.mockResolvedValue({ ...pending, status: 'conflict' });
  expect(
    (await POST(request({ ...body, interestAccepted: false }))).status
  ).toBe(409);
});
it('does not leak provider or database detail when setup throws', async () => {
  mocks.run.mockRejectedValue(new Error('private database host'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private');
});
