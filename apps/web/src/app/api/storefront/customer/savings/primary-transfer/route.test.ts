import { createHash } from 'node:crypto';
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
  recovery: vi.fn(),
  identity: vi.fn(),
  submit: vi.fn(),
  features: vi.fn(),
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
  pinProof: createHash('sha256').update('s5-route-proof').digest('hex'),
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
it('drains status recovery through the recovery runtime after rollback', async () => {
  mocks.runtime.mockReturnValue(null);
  mocks.recovery.mockReturnValue({
    merchantId,
    businessId: 'business',
    providerToken: 'test-only',
    configuration: { integrationId: 'integration', environment: 'staging' },
  });
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
    expect.objectContaining({ operationId: body.operationId })
  );
});
it('answers SAVINGS_NOT_READY (503) for a status read when no runtime exists at all', async () => {
  mocks.runtime.mockReturnValue(null);
  mocks.recovery.mockReturnValue(null);
  const response = await PATCH(
    request({ merchantId, operationId: body.operationId })
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'SAVINGS_NOT_READY' });
  expect(checkStatus).not.toHaveBeenCalled();
});
it('answers SAVINGS_MERCHANT_NOT_PRIMARY (409) when the runtime belongs to another merchant', async () => {
  const response = await PATCH(
    request({
      merchantId: '99999999-9999-4999-8999-999999999999',
      operationId: body.operationId,
    })
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: 'SAVINGS_MERCHANT_NOT_PRIMARY',
  });
  expect(checkStatus).not.toHaveBeenCalled();
  expect(mocks.identity).not.toHaveBeenCalled();
});
it('also answers SAVINGS_MERCHANT_NOT_PRIMARY through the recovery runtime', async () => {
  mocks.runtime.mockReturnValue(null);
  mocks.recovery.mockReturnValue({
    merchantId,
    businessId: 'business',
    providerToken: 'test-only',
    configuration: { integrationId: 'integration', environment: 'staging' },
  });
  const response = await PATCH(
    request({
      merchantId: '99999999-9999-4999-8999-999999999999',
      operationId: body.operationId,
    })
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: 'SAVINGS_MERCHANT_NOT_PRIMARY',
  });
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
      pinProof: body.pinProof,
    })
  );
});
it('lets the database decide a request with no proof, so merchants without PIN checking keep funding', async () => {
  const { pinProof: _omitted, ...withoutProof } = body;
  mocks.submit.mockResolvedValue({ status: 'pending' });
  const response = await POST(request(withoutProof));
  expect(response.status).toBe(202);
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({ pinProof: '' })
  );
});
it('asks for the PIN when the database says a proof is missing', async () => {
  const { pinProof: _omitted, ...withoutProof } = body;
  mocks.submit.mockResolvedValue({ status: 'pin_refused', reason: 'missing' });
  const response = await POST(request(withoutProof));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'PIN_PROOF_REQUIRED' });
});
it('keeps the not-ready answer ahead of the PIN requirement so legacy funding can take over', async () => {
  const { pinProof: _omitted, ...withoutProof } = body;
  mocks.runtime.mockReturnValue(null);
  const response = await POST(request(withoutProof));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'SAVINGS_NOT_READY' });
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('keeps the savings-disabled answer ahead of the PIN requirement', async () => {
  const { pinProof: _omitted, ...withoutProof } = body;
  mocks.features.mockResolvedValue({
    autoDebitEnabled: true,
    paystackEnabled: true,
    savingsEnabled: false,
  });
  const response = await POST(request(withoutProof));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: 'CUSTOMER_SAVINGS_DISABLED',
  });
});
it('rejects a malformed PIN proof as invalid input', async () => {
  const response = await POST(request({ ...body, pinProof: 'not-hex' }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'INVALID_INPUT' });
  expect(mocks.submit).not.toHaveBeenCalled();
});
it('maps a refused PIN proof to a retry-with-PIN response and never reports a transfer', async () => {
  mocks.submit.mockResolvedValue({ status: 'pin_refused', reason: 'expired' });
  const response = await POST(request());
  expect(response.status).toBe(403);
  const payload = await response.json();
  expect(payload).toMatchObject({ code: 'PIN_PROOF_REFUSED' });
  expect(JSON.stringify(payload)).not.toContain('expired');
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
