import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { provisioningFixture } from '@/lib/piggyvest/primary-savings-provisioning.test-support';
import { PATCH, POST } from './route';

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
  () => ({
    getPrimaryCustomerSavingsFeatureSettings: mocks.features,
  })
);
const body = {
  merchantId: provisioningFixture.scope.merchantId,
  goalId: provisioningFixture.goalId,
  consent: true,
  interestAccepted: false,
};
const goal = {
  id: body.goalId,
  merchant_id: body.merchantId,
  customer_id: provisioningFixture.scope.customerId,
  status: 'active',
  terms_accepted_at: '2026-10-07T00:00:00Z',
  non_withdrawable_accepted_at: '2026-10-07T00:00:00Z',
};
function request(input: unknown = body) {
  return new NextRequest(
    'https://example.test/api/storefront/customer/savings/primary-provisioning',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
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
  mocks.run.mockResolvedValue({
    goalId: body.goalId,
    status: 'pending',
    interestAccepted: false,
    interestEnrollment: 'not_requested',
    accounts: [],
  });
});
it('authenticates before any configuration, CSRF or database access', async () => {
  mocks.auth.mockResolvedValue({ user: null });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.csrf).not.toHaveBeenCalled();
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  POST,
  PATCH,
])('requires CSRF for setup and recovery', async (handler) => {
  mocks.csrf.mockResolvedValue({ valid: false });
  expect((await handler(request())).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  { consent: false },
  { interestAccepted: 'true' },
  { interestAccepted: null },
  { interestAccepted: undefined },
  { customerId: 'foreign' },
  { providerWalletId: 'foreign' },
  { metadata: { interestOptIn: true } },
])('rejects untrusted provisioning input %j', async (change) => {
  expect((await POST(request({ ...body, ...change }))).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it('rejects malformed JSON before querying', async () => {
  const invalid = new NextRequest('https://example.test/setup', {
    method: 'POST',
    body: '{',
  });
  expect((await POST(invalid)).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('returns an explicit pending enrollment decision and scopes goal lookup to the user', async () => {
  const response = await POST(request());
  expect(response.status).toBe(202);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    goalId: body.goalId,
    status: 'pending',
    interestAccepted: false,
    interestEnrollment: 'not_requested',
    accounts: [],
  });
  expect(mocks.eq).toHaveBeenCalledWith(
    'customer_id',
    provisioningFixture.scope.customerId
  );
  expect(mocks.eq).toHaveBeenCalledWith('merchant_id', body.merchantId);
  expect(mocks.run).toHaveBeenCalledWith({
    configuration: provisioningFixture.configuration,
    scope: provisioningFixture.scope,
    goalId: body.goalId,
    mode: 'provision',
    interestAccepted: false,
  });
});
it('recovery invokes only the read/reconcile mode', async () => {
  expect(
    (await PATCH(request({ merchantId: body.merchantId, goalId: body.goalId })))
      .status
  ).toBe(202);
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'recover' })
  );
});
it('rejects another merchant before querying', async () => {
  expect(
    (
      await POST(
        request({ ...body, merchantId: provisioningFixture.scope.userId })
      )
    ).status
  ).toBe(503);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it('requires verified primary customer identity', async () => {
  mocks.identity.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(409);
  expect(mocks.run).not.toHaveBeenCalled();
});
it('honors savings feature disablement', async () => {
  mocks.features.mockResolvedValue({ savingsEnabled: false });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each([
  null,
  { ...goal, customer_id: 'foreign' },
  { ...goal, merchant_id: 'foreign' },
])('rejects missing or foreign goals', async (data) => {
  mocks.goal.mockResolvedValue({ data, error: null });
  expect((await POST(request())).status).toBe(404);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  { status: 'paused' },
  { terms_accepted_at: null },
  { non_withdrawable_accepted_at: null },
])('requires durable active goal terms %j', async (change) => {
  mocks.goal.mockResolvedValue({ data: { ...goal, ...change }, error: null });
  expect((await POST(request())).status).toBe(409);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  { status: 'ready', code: 200 },
  { status: 'conflict', code: 409 },
  { status: 'not_found', code: 404 },
  { status: 'unavailable', code: 503 },
])('maps provisioning status $status to HTTP $code', async ({
  status,
  code,
}) => {
  mocks.run.mockResolvedValue({
    goalId: body.goalId,
    status,
    interestAccepted: false,
    interestEnrollment: 'not_requested',
    accounts:
      status === 'ready'
        ? [
            {
              accountNumber: '0123456789',
              accountName: 'Synthetic',
              bankName: 'Synthetic Bank',
            },
          ]
        : [],
  });
  expect((await POST(request())).status).toBe(code);
});
it('passes only explicit authenticated request interest consent to provisioning', async () => {
  expect(
    (await POST(request({ ...body, interestAccepted: true }))).status
  ).toBe(202);
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({ interestAccepted: true })
  );
});
it('rejects attempts to change interest choice on recovery', async () => {
  expect(
    (
      await PATCH(
        request({
          merchantId: body.merchantId,
          goalId: body.goalId,
          interestAccepted: true,
        })
      )
    ).status
  ).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  undefined,
  null,
  'true',
  0,
])('rejects non-explicit boolean interest consent %j before any provisioning', async (interestAccepted) => {
  const response = await POST(request({ ...body, interestAccepted }));
  expect(response.status).toBe(400);
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it('redacts storage failures and never starts provider fallback', async () => {
  mocks.goal.mockResolvedValue({
    data: null,
    error: { message: 'private database details' },
  });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private database details'
  );
  expect(mocks.run).not.toHaveBeenCalled();
});
