import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletPaymentMismatchError } from './deliver-paid-imei-lookup';
import { payImeiWalletPayment } from './pay-imei-wallet-payment';

vi.mock('server-only', () => ({}));
vi.mock('../route-cache-helpers', () => ({}));

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const IMEI = '356938035643809';
const SALT = 'test-salt';
const hash = (v: string) => createHmac('sha256', SALT).update(v).digest('hex');
const runtime = {
  merchantId: 'm',
  businessId: 'b',
  configuration: {
    integrationId: '22222222-2222-4222-8222-222222222222',
    environment: 'staging',
  },
};
const lookup = {
  id: LOOKUP,
  amount_ngn: 500,
  customer_id: 'c',
  merchant_id: 'm',
  imei_hash: hash(IMEI),
  status: 'pending',
  tier: 'simLock',
  device_category: 'smartphone',
  cached_response: null,
  cached_status: null,
};
const payment = (state: string) => ({
  state,
  fulfilment: 'awaiting',
  purpose: 'imei_check',
  purchaseRef: LOOKUP,
  amountKobo: 50000,
  refund: null,
});

function deps(overrides: Record<string, unknown> = {}) {
  return {
    readRuntime: vi.fn(() => runtime as never),
    readRecoveryRuntime: vi.fn(() => runtime as never),
    resolveIdentity: vi.fn(async () => ({
      merchantId: 'm',
      customerId: 'c',
      userId: 'u',
    })),
    hashSalt: vi.fn(() => SALT),
    readLookup: vi.fn(async () => lookup as never),
    check: vi.fn(async () => payment('issued') as never),
    pay: vi.fn(async () => ({ status: 'confirmed' as const })),
    deliver: vi.fn(
      async () => new Response('{"status":"complete"}', { status: 200 })
    ),
    ...overrides,
  };
}
const body = { operationId: OP, pinProof: 'a'.repeat(64), imei: IMEI };

beforeEach(() => vi.clearAllMocks());

describe('payImeiWalletPayment', () => {
  it('pays with the PIN proof, then delivers the confirmed lookup', async () => {
    const d = deps();
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(200);
    expect(d.pay).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OP, pinProof: 'a'.repeat(64) })
    );
    expect(d.deliver).toHaveBeenCalledTimes(1);
  });

  it('moves nothing and asks for the PIN when the proof is missing or refused', async () => {
    for (const reason of ['missing', 'mismatch']) {
      const d = deps({
        pay: vi.fn(async () => ({ status: 'pin_refused' as const, reason })),
      });
      const response = await payImeiWalletPayment(
        { lookupId: LOOKUP, body, auth: {} as never },
        d
      );
      expect(response.status).toBe(reason === 'missing' ? 400 : 403);
      expect(d.deliver).not.toHaveBeenCalled();
    }
  });

  it('refuses an IMEI that is not the one the lookup was created for, before any payment', async () => {
    const d = deps();
    const response = await payImeiWalletPayment(
      {
        lookupId: LOOKUP,
        body: { ...body, imei: '490154203237518' },
        auth: {} as never,
      },
      d
    );
    expect(response.status).toBe(409);
    expect(d.pay).not.toHaveBeenCalled();
  });

  it('still reconciles a status re-check with a mismatched IMEI, but never delivers it', async () => {
    const d = deps();
    const response = await payImeiWalletPayment(
      {
        lookupId: LOOKUP,
        body: { ...body, pinProof: '', imei: '490154203237518' },
        auth: {} as never,
      },
      d
    );
    expect(d.pay).toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it("bugfix: returns a finished lookup's saved result even if the IMEI no longer hashes the same (Codex P1)", async () => {
    const d = deps({
      readLookup: vi.fn(
        async () =>
          ({
            ...lookup,
            status: 'completed',
            imei_hash: 'f'.repeat(64),
          }) as never
      ),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body: { ...body, pinProof: '' }, auth: {} as never },
      d
    );
    expect(response.status).toBe(200);
    expect(d.deliver).toHaveBeenCalledTimes(1);
  });

  it('answers a wrong-purchase claim with a definite 409', async () => {
    const d = deps({
      deliver: vi.fn(async () =>
        Promise.reject(new WalletPaymentMismatchError())
      ),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_OPERATION_INVALID',
    });
  });

  it('refuses a payment that belongs to another purchase', async () => {
    const d = deps({
      check: vi.fn(
        async () =>
          ({ ...payment('issued'), purchaseRef: 'another-lookup' }) as never
      ),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(409);
    expect(d.pay).not.toHaveBeenCalled();
  });

  it('keeps a sent but unconfirmed payment pending (no delivery, no retry)', async () => {
    const d = deps({
      pay: vi.fn(async () => ({ status: 'pending' as const })),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'payment_pending',
    });
    expect(d.deliver).not.toHaveBeenCalled();
  });

  it('says so when the wallet cannot cover the check', async () => {
    const d = deps({
      pay: vi.fn(async () => ({ status: 'insufficient' as const })),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
  });

  it('needs wallet pay switched on to spend a new PIN proof', async () => {
    const d = deps({ readRuntime: vi.fn(() => null) });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(503);
    expect(d.pay).not.toHaveBeenCalled();
  });

  it('still answers a status re-check (empty proof) after wallet pay is switched off', async () => {
    const d = deps({
      readRuntime: vi.fn(() => null),
      pay: vi.fn(async () => ({ status: 'confirmed' as const })),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body: { ...body, pinProof: '' }, auth: {} as never },
      d
    );
    expect(response.status).toBe(200);
    expect(d.readRecoveryRuntime).toHaveBeenCalled();
  });

  it('answers 404 for a lookup that is not this customer’s', async () => {
    const d = deps({ readLookup: vi.fn(async () => null) });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(404);
  });

  describe('bugfix: review round four (#4220)', () => {
    it('refuses a payment whose amount is not the lookup price, before spending the PIN', async () => {
      const d = deps({
        check: vi.fn(
          async () => ({ ...payment('issued'), amountKobo: 49999 }) as never
        ),
      });
      const response = await payImeiWalletPayment(
        { lookupId: LOOKUP, body, auth: {} as never },
        d
      );
      expect(response.status).toBe(409);
      expect(d.pay).not.toHaveBeenCalled();
    });

    it('treats a lookup on a retired tier as a mismatch: no new payment, no delivery', async () => {
      const retired = { ...lookup, tier: 'retiredTier' };
      const spend = deps({ readLookup: vi.fn(async () => retired as never) });
      const refused = await payImeiWalletPayment(
        { lookupId: LOOKUP, body, auth: {} as never },
        spend
      );
      expect(refused.status).toBe(409);
      expect(spend.pay).not.toHaveBeenCalled();
      const recheck = deps({ readLookup: vi.fn(async () => retired as never) });
      const status = await payImeiWalletPayment(
        {
          lookupId: LOOKUP,
          body: { ...body, pinProof: '' },
          auth: {} as never,
        },
        recheck
      );
      expect(recheck.pay).toHaveBeenCalled();
      expect(status.status).toBe(409);
      expect(recheck.deliver).not.toHaveBeenCalled();
    });
  });

  it('bugfix: a finished lookup answers a status check while the IMEI salt is missing (Codex P2)', async () => {
    const done = { ...lookup, status: 'completed' };
    const d = deps({
      hashSalt: vi.fn(() => undefined),
      readLookup: vi.fn(async () => done as never),
    });
    const check = { lookupId: LOOKUP, body: { ...body, pinProof: '' } };
    const answer = await payImeiWalletPayment({ ...check, auth: {} }, d);
    expect(answer.status).toBe(200);
    expect(d.deliver).toHaveBeenCalledTimes(1);
    // A pending lookup (a new delivery) or a new PIN still needs the salt.
    const pending = deps({ hashSalt: vi.fn(() => undefined) });
    const refused = await payImeiWalletPayment({ ...check, auth: {} }, pending);
    expect(refused.status).toBe(503);
    expect(pending.pay).not.toHaveBeenCalled();
  });
});
