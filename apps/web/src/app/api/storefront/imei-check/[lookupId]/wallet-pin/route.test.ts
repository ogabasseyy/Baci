import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  binding: vi.fn(),
  limit: vi.fn(),
  verify: vi.fn(),
  readLookup: vi.fn(),
}));
vi.mock('@/lib/imei-access', () => ({
  createImeiAccessClient: () => ({ readStatus: mocks.readLookup }),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/wallet-pay-runtime', () => ({
  readWalletPayRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/wallet-pay-service', () => ({
  readWalletPayPinBinding: mocks.binding,
}));
vi.mock('@/lib/wallet-pin/wallet-pin-customer-limit', () => ({
  chargeWalletPinCustomerLimit: mocks.limit,
}));
vi.mock('@/lib/piggyvest/goal-pin-verify', () => ({
  verifyGoalPin: mocks.verify,
}));

function call(body: unknown, lookupId = LOOKUP) {
  return POST(
    new NextRequest(
      `https://shop.example.test/api/storefront/imei-check/${LOOKUP}/wallet-pin`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),
    { params: Promise.resolve({ lookupId }) }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'u' },
    supabase: { rpc: vi.fn() },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({
    merchantId: 'm',
    businessId: 'b',
    configuration: {
      integrationId: '22222222-2222-4222-8222-222222222222',
      environment: 'staging',
    },
  });
  mocks.identity.mockResolvedValue({
    merchantId: 'm',
    customerId: 'c',
    userId: 'u',
  });
  mocks.binding.mockResolvedValue({
    binding: {
      purpose: 'wallet_pay',
      amountKobo: 50000,
      idempotencyKeySha256: 'a'.repeat(64),
    },
    purchase: { purpose: 'imei_check', purchaseRef: LOOKUP },
  });
  mocks.limit.mockResolvedValue(null);
  mocks.readLookup.mockResolvedValue({
    data: { amount_ngn: 500 },
    error: null,
  });
  mocks.verify.mockResolvedValue({
    status: 'verified',
    proof: 'b'.repeat(64),
    expiresAt: 'x',
  });
});

describe('POST /imei-check/[lookupId]/wallet-pin', () => {
  it('mints a proof bound to the issued payment, never to client values', async () => {
    const response = await call({ operationId: OP, pin: '1234' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      proof: 'b'.repeat(64),
      expiresAt: 'x',
    });
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: {
          purpose: 'wallet_pay',
          amountKobo: 50000,
          idempotencyKeySha256: 'a'.repeat(64),
        },
        merchantId: 'm',
        userId: 'u',
        pin: '1234',
      })
    );
  });

  it('bugfix: charges the wallet pay PIN budget, never the savings goal one (Codex P2)', async () => {
    await call({ operationId: OP, pin: '1234' });
    expect(mocks.limit).toHaveBeenCalledWith(
      'wallet-pay-verify',
      expect.anything(),
      expect.anything()
    );
  });

  it('refuses a client-sent amount', async () => {
    const response = await call({
      operationId: OP,
      pin: '1234',
      amountKobo: 1,
    });
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('refuses an operation issued for another purchase', async () => {
    mocks.binding.mockResolvedValue({
      binding: {
        purpose: 'wallet_pay',
        amountKobo: 50000,
        idempotencyKeySha256: 'a'.repeat(64),
      },
      purchase: {
        purpose: 'imei_check',
        purchaseRef: '99999999-9999-4999-8999-999999999999',
      },
    });
    const response = await call({ operationId: OP, pin: '1234' });
    expect(response.status).toBe(409);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('refuses an unknown or expired operation without examining the PIN', async () => {
    mocks.binding.mockResolvedValue(null);
    const response = await call({ operationId: OP, pin: '1234' });
    expect(response.status).toBe(409);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('is unavailable when wallet pay is off', async () => {
    mocks.runtime.mockReturnValue(null);
    const response = await call({ operationId: OP, pin: '1234' });
    expect(response.status).toBe(503);
  });

  it('reports a wrong PIN with the attempts left', async () => {
    mocks.verify.mockResolvedValue({
      status: 'incorrect',
      attemptsRemaining: 3,
    });
    const response = await call({ operationId: OP, pin: '1234' });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PIN_INCORRECT',
      attemptsRemaining: 3,
    });
  });

  it('requires sign-in', async () => {
    mocks.auth.mockResolvedValue({ error: 'x' });
    expect((await call({ operationId: OP, pin: '1234' })).status).toBe(401);
  });
  it('refuses a malformed lookup id before any PIN check', async () => {
    const response = await call(
      { operationId: OP, pin: '1234' },
      '-'.repeat(36)
    );
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('bugfix: refuses a payment whose amount is not the lookup price, before charging the PIN budget (Muse)', async () => {
    mocks.readLookup.mockResolvedValue({
      data: { amount_ngn: 499 },
      error: null,
    });
    const response = await call({ operationId: OP, pin: '1234' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_OPERATION_INVALID',
    });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
