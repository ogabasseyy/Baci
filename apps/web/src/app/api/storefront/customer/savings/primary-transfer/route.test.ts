import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { PATCH, POST } from './route';

const checkStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/piggyvest/primary-wallet-savings-status-runtime', () => ({
  checkPrimaryWalletSavingsStatus: checkStatus,
}));

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  submit: vi.fn(),
  features: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/primary-wallet-savings-submission-runtime', () => ({
  submitPrimaryWalletSavings: mocks.submit,
}));
vi.mock(
  '@/app/api/storefront/customer/savings/customer-savings-feature-settings',
  () => ({
    getPrimaryCustomerSavingsFeatureSettings: mocks.features,
  })
);
const merchantId = '11111111-1111-4111-8111-111111111111';
const body = {
  merchantId,
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 2000,
};
function request(input: unknown = body) {
  return new NextRequest(
    'https://example.com/api/storefront/customer/savings/primary-transfer',
    { method: 'POST', body: JSON.stringify(input) }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  checkStatus.mockResolvedValue({ status: 'pending' });
  mocks.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {} });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({
    merchantId,
    businessId: 'business',
    providerToken: 'test-only',
    configuration: { integrationId: 'integration', environment: 'staging' },
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'customer',
    userId: 'user',
  });
  mocks.submit.mockResolvedValue({ status: 'pending' });
  mocks.features.mockResolvedValue({
    autoDebitEnabled: true,
    paystackEnabled: true,
    savingsEnabled: true,
  });
});
it('refreshes only an authenticated operation without invoking submission', async () => {
  const response = await PATCH(
    request({ merchantId, operationId: body.operationId })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: 'pending',
    operationId: body.operationId,
  });
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(checkStatus).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId: body.operationId,
      scope: expect.objectContaining({
        customerId: 'customer',
        userId: 'user',
      }),
    })
  );
});
it('does not disclose another customer operation through status refresh', async () => {
  checkStatus.mockResolvedValue({ status: 'not_found' });
  expect(
    (await PATCH(request({ merchantId, operationId: body.operationId }))).status
  ).toBe(404);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('checks auth before configuration or transfer processing', async () => {
  mocks.auth.mockResolvedValue({ user: null });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('rejects CSRF failure before transfer processing', async () => {
  mocks.csrf.mockResolvedValue({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('rejects client-selected wallets and fractional amounts', async () => {
  expect(
    (await POST(request({ ...body, sourceWalletId: 'foreign' }))).status
  ).toBe(400);
  expect((await POST(request({ ...body, amountKobo: 1.5 }))).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('returns pending and binds the request to the authenticated customer', async () => {
  const response = await POST(request());
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    status: 'pending',
    operationId: body.operationId,
  });
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: {
        merchantId,
        customerId: 'customer',
        userId: 'user',
        integrationId: 'integration',
        environment: 'staging',
        businessId: 'business',
      },
      request: {
        goalId: body.goalId,
        operationId: body.operationId,
        amountKobo: 2000,
      },
    })
  );
});
it('does not expose database errors or start a fallback payment', async () => {
  mocks.submit.mockRejectedValue(new Error('private database detail'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private database detail'
  );
});
it('refuses new transfers after savings is disabled', async () => {
  mocks.features.mockResolvedValue({
    autoDebitEnabled: true,
    paystackEnabled: true,
    savingsEnabled: false,
  });
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: 'CUSTOMER_SAVINGS_DISABLED',
  });
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('keeps status reads available after savings is disabled', async () => {
  mocks.features.mockResolvedValue({
    autoDebitEnabled: true,
    paystackEnabled: true,
    savingsEnabled: false,
  });
  const response = await PATCH(
    request({ merchantId, operationId: body.operationId })
  );
  expect(response.status).toBe(200);
  expect(checkStatus).toHaveBeenCalled();
});
