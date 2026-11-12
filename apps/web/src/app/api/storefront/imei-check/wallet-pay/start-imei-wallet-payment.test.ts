import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startImeiWalletPayment } from './start-imei-wallet-payment';

vi.mock('server-only', () => ({}));

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const runtime = {
  merchantId: 'merchant-1',
  businessId: 'business-1',
  configuration: {
    integrationId: '22222222-2222-4222-8222-222222222222',
    environment: 'staging',
  },
} as never;
const identity = {
  merchantId: 'merchant-1',
  customerId: 'customer-1',
  userId: 'user-1',
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    readRuntime: vi.fn(() => runtime),
    resolveIdentity: vi.fn(async () => identity),
    issue: vi.fn(async () => ({
      status: 'issued' as const,
      operationId: OP,
      amountKobo: 50000,
      expiresAt: '2026-11-12T17:00:00Z',
    })),
    findForPurchase: vi.fn(async () => ({
      operationId: OP,
      state: 'issued' as const,
    })),
    ...overrides,
  };
}
function input(overrides: Record<string, unknown> = {}) {
  return {
    binding: { provider: 'sickw' },
    serviceTier: { price: 500 },
    customer: { id: 'customer-1' },
    merchantId: 'merchant-1',
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
    imeiHash: 'a'.repeat(64),
    deviceCategory: 'smartphone',
    requestedTier: 'simLock',
    replayContext: {
      customerId: 'customer-1',
      imeiHash: 'a'.repeat(64),
      merchantId: 'merchant-1',
      tier: 'simLock',
    },
    supabase: {},
    user: { id: 'user-1' },
    supabaseAdmin: {
      insertPending: vi.fn(async () => ({ data: { id: LOOKUP }, error: null })),
    },
    ...overrides,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('startImeiWalletPayment', () => {
  it('creates the lookup and issues a payment of exactly the server price in kobo', async () => {
    const d = deps();
    const response = await startImeiWalletPayment(input(), d);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: 'payment_required',
      lookupId: LOOKUP,
      operationId: OP,
      amountKobo: 50000,
      expiresAt: '2026-11-12T17:00:00Z',
    });
    expect(d.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          purpose: 'imei_check',
          purchaseRef: LOOKUP,
          amountKobo: 50000,
        },
        scope: expect.objectContaining({
          customerId: 'customer-1',
          merchantId: 'merchant-1',
          businessId: 'business-1',
        }),
      })
    );
  });

  it('is unavailable (nothing created) when wallet pay is off', async () => {
    const i = input();
    const response = await startImeiWalletPayment(
      i,
      deps({ readRuntime: vi.fn(() => null) })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PIGGYVEST_PAY_UNAVAILABLE',
    });
    expect(
      (
        i as {
          supabaseAdmin: { insertPending: { mock: { calls: unknown[] } } };
        }
      ).supabaseAdmin.insertPending.mock.calls
    ).toHaveLength(0);
  });

  it('is unavailable for a merchant that is not the PiggyVest merchant', async () => {
    const response = await startImeiWalletPayment(
      input({ merchantId: 'merchant-2' }),
      deps()
    );
    expect(response.status).toBe(409);
  });

  it('is unavailable for Petrock (asynchronous) tiers', async () => {
    const response = await startImeiWalletPayment(
      input({ binding: { provider: 'petrock' } }),
      deps()
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'PIGGYVEST_PAY_UNAVAILABLE_FOR_TIER',
    });
  });

  it('asks the customer to finish their PiggyVest wallet when it is not ready', async () => {
    const response = await startImeiWalletPayment(
      input(),
      deps({ resolveIdentity: vi.fn(async () => null) })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PIGGYVEST_WALLET_NOT_READY',
    });
  });

  it('reports a payment already sent for this lookup instead of issuing another', async () => {
    const response = await startImeiWalletPayment(
      input(),
      deps({
        issue: vi.fn(async () => ({
          status: 'pending' as const,
          operationId: OP,
          amountKobo: 50000,
        })),
      })
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'payment_pending',
      lookupId: LOOKUP,
      operationId: OP,
    });
  });

  it('answers 503 when the collection wallet is not configured', async () => {
    const response = await startImeiWalletPayment(
      input(),
      deps({ issue: vi.fn(async () => ({ status: 'unavailable' as const })) })
    );
    expect(response.status).toBe(503);
  });
  it('answers 503 (not 500) when wallet pay is on but misconfigured', async () => {
    const response = await startImeiWalletPayment(
      input(),
      deps({
        readRuntime: vi.fn(() => {
          throw new Error('missing collection wallet');
        }),
      })
    );
    expect(response.status).toBe(503);
  });

  describe('replay of the same Idempotency-Key', () => {
    const existing = {
      id: LOOKUP,
      status: 'pending',
      customer_id: 'customer-1',
      merchant_id: 'merchant-1',
      imei_hash: 'a'.repeat(64),
      tier: 'simLock',
      device_category: 'smartphone',
      amount_ngn: 500,
      cached_response: null,
      cached_status: null,
    };
    function replayInput(row: Record<string, unknown>) {
      return input({
        supabaseAdmin: {
          insertPending: vi.fn(async () => ({
            data: null,
            error: { code: '23505' },
          })),
          readReplay: vi.fn(async () => ({ data: row, error: null })),
        },
      });
    }

    it('returns the payment already issued for this wallet lookup', async () => {
      const d = deps();
      const response = await startImeiWalletPayment(replayInput(existing), d);
      expect(response.status).toBe(202);
      expect(d.issue).toHaveBeenCalled();
    });

    it('never wallet-pays a lookup a concurrent store-credit request owns', async () => {
      const d = deps({ findForPurchase: vi.fn(async () => null) });
      const response = await startImeiWalletPayment(replayInput(existing), d);
      expect(response.status).not.toBe(202);
      expect(d.issue).not.toHaveBeenCalled();
    });

    it('treats a different device as another request', async () => {
      const d = deps();
      const response = await startImeiWalletPayment(
        replayInput({ ...existing, device_category: 'tablet' }),
        d
      );
      expect(response.status).not.toBe(202);
      expect(d.issue).not.toHaveBeenCalled();
    });
  });
});
