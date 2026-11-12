import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  pay: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('../../wallet-pay/pay-imei-wallet-payment', () => ({
  payImeiWalletPayment: mocks.pay,
}));
vi.mock('../../wallet-pay/pay-imei-wallet-payment-deps', () => ({
  createPayImeiWalletPaymentDeps: () => ({}),
}));

function call(body: unknown, lookupId = LOOKUP) {
  return POST(
    new NextRequest(
      `https://shop.example.test/api/storefront/imei-check/${lookupId}/wallet-pay`,
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
  mocks.auth.mockResolvedValue({ user: { id: 'u' }, supabase: {} });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.pay.mockResolvedValue(
    new Response('{"status":"complete"}', { status: 200 })
  );
});

describe('POST /imei-check/[lookupId]/wallet-pay', () => {
  it('passes a valid request to the handler', async () => {
    const response = await call({
      operationId: OP,
      pinProof: 'a'.repeat(64),
      imei: '356938035643809',
    });
    expect(response.status).toBe(200);
    expect(mocks.pay).toHaveBeenCalledWith(
      expect.objectContaining({
        lookupId: LOOKUP,
        body: expect.objectContaining({ operationId: OP }),
      }),
      expect.anything()
    );
  });

  it('refuses a client-sent amount and a malformed lookup id', async () => {
    expect(
      (await call({ operationId: OP, imei: '356938035643809', amountKobo: 1 }))
        .status
    ).toBe(400);
    expect(
      (await call({ operationId: OP, imei: '356938035643809' }, 'not-a-lookup'))
        .status
    ).toBe(400);
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it('never reports a failure it can not prove: an error answers "check again"', async () => {
    mocks.pay.mockRejectedValue(new Error('db down'));
    const response = await call({ operationId: OP, imei: '356938035643809' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_STATUS_UNKNOWN',
    });
  });

  it('requires sign-in and CSRF', async () => {
    mocks.auth.mockResolvedValue({ error: 'x' });
    expect(
      (await call({ operationId: OP, imei: '356938035643809' })).status
    ).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: 'u' }, supabase: {} });
    mocks.csrf.mockResolvedValue({ valid: false });
    expect(
      (await call({ operationId: OP, imei: '356938035643809' })).status
    ).toBe(403);
  });
});
