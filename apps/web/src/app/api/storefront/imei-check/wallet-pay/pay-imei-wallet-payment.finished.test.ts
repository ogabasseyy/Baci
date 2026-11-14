import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('payImeiWalletPayment on a finished lookup', () => {
  it('bugfix: never charges a new PIN proof once the lookup has finished (Codex P1)', async () => {
    const d = deps({
      readLookup: vi.fn(
        async () => ({ ...lookup, status: 'refunded_error' }) as never
      ),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(d.pay).not.toHaveBeenCalled();
    expect(d.deliver).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('bugfix: a refunded payment reaches its refunded outcome even when the IMEI no longer matches (Codex P2)', async () => {
    const d = deps({
      readLookup: vi.fn(
        async () => ({ ...lookup, imei_hash: 'f'.repeat(64) }) as never
      ),
      check: vi.fn(
        async () =>
          ({ ...payment('confirmed'), fulfilment: 'refunded' }) as never
      ),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body: { ...body, pinProof: '' }, auth: {} as never },
      d
    );
    expect(d.deliver).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
  it('bugfix: a finished lookup answers a PIN-proof request even after the salt rotated or went missing (Codex P2)', async () => {
    const finished = {
      ...lookup,
      status: 'completed',
      imei_hash: 'f'.repeat(64),
    };
    const rotated = deps({ readLookup: vi.fn(async () => finished as never) });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      rotated
    );
    expect(response.status).toBe(200);
    expect(rotated.pay).not.toHaveBeenCalled();
    expect(rotated.deliver).toHaveBeenCalledTimes(1);
    const noSalt = deps({
      readLookup: vi.fn(async () => finished as never),
      hashSalt: vi.fn(() => undefined),
    });
    const second = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      noSalt
    );
    expect(second.status).toBe(200);
    expect(noSalt.deliver).toHaveBeenCalledTimes(1);
  });

  it('bugfix: a lookup that finished while paying answers its saved result, never a new charge (Codex P1)', async () => {
    // The database refuses the reservation (imei_check_already_finished):
    // nothing was spent; the re-read lookup answers.
    const readLookup = vi
      .fn()
      .mockResolvedValueOnce(lookup)
      .mockResolvedValueOnce({ ...lookup, status: 'refunded_error' });
    const d = deps({
      readLookup,
      pay: vi.fn(async () => {
        throw new Error('imei_check_already_finished');
      }),
    });
    const response = await payImeiWalletPayment(
      { lookupId: LOOKUP, body, auth: {} as never },
      d
    );
    expect(response.status).toBe(200);
    expect(d.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        lookup: expect.objectContaining({ status: 'refunded_error' }),
      })
    );
  });

  it('rethrows a payment failure while the lookup is still pending (the route answers status unknown)', async () => {
    const d = deps({
      pay: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    await expect(
      payImeiWalletPayment({ lookupId: LOOKUP, body, auth: {} as never }, d)
    ).rejects.toThrow('down');
    expect(d.deliver).not.toHaveBeenCalled();
  });
});
