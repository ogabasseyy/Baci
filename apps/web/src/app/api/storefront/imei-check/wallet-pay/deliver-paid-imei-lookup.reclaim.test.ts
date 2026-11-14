import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverPaidImeiLookup,
  WalletPaymentMismatchError,
} from './deliver-paid-imei-lookup';

vi.mock('server-only', () => ({}));
const cache = vi.hoisted(() => ({ response: vi.fn(), success: vi.fn() }));
vi.mock('../route-cache-helpers', () => ({
  cacheSuccessfulLookup: cache.success,
  cacheLookupResponse: cache.response,
}));

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const input = {
  lookup: {
    id: LOOKUP,
    amount_ngn: 500,
    cached_response: null,
    cached_status: null,
    customer_id: 'c',
    merchant_id: 'm',
    imei_hash: 'h',
    status: 'pending' as const,
    tier: 'simLock' as const,
    device_category: 'smartphone' as const,
  },
  operationId: OP,
  normalizedImei: '356938035643809',
  supabaseAdmin: {} as never,
  payment: { purpose: 'imei_check', purchaseRef: LOOKUP, amountKobo: 50000 },
};
const deps = (savedStatus: string) => ({
  claim: vi.fn(async () => ({
    status: 'reclaimed' as const,
    purpose: 'imei_check' as const,
    purchaseRef: LOOKUP,
    amountKobo: 50000,
    claimToken: 'tok-2',
  })),
  finish: vi.fn(async (_op: string, outcome: string) =>
    outcome === 'fulfilled' ? 'fulfilled' : 'refund_owed'
  ),
  refund: vi.fn(async () => 'pending'),
  readStatus: vi.fn(async () => savedStatus),
  prepare: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

describe('bugfix: a reclaim refunded a result saved after it read the lookup (Codex P1)', () => {
  it('records the saved result as delivered and never refunds it', async () => {
    const d = deps('completed');
    const response = await deliverPaidImeiLookup(input, d);
    expect(response.status).toBe(202);
    expect(d.finish).toHaveBeenCalledWith(OP, 'fulfilled', 'tok-2');
    expect(d.refund).not.toHaveBeenCalled();
    expect(d.prepare).not.toHaveBeenCalled();
    expect(cache.response).not.toHaveBeenCalled();
  });

  it('still refunds a reclaim whose lookup is still pending, buying nothing', async () => {
    const d = deps('pending');
    await deliverPaidImeiLookup(input, d);
    expect(d.finish).toHaveBeenCalledWith(OP, 'failed', 'tok-2');
    expect(d.refund).toHaveBeenCalledTimes(1);
    expect(d.prepare).not.toHaveBeenCalled();
  });
});

describe('bugfix: the refunded branch trusted the caller for the payment (Muse)', () => {
  const refunded = {
    ...input,
    lookup: { ...input.lookup, status: 'refunded_error' as const },
  };

  it("retries the refund of this lookup's own payment", async () => {
    const d = deps('refunded_error');
    await deliverPaidImeiLookup(refunded as never, d);
    expect(d.refund).toHaveBeenCalledWith(OP);
  });

  it("refuses another purchase's payment, refunding nothing", async () => {
    const d = deps('refunded_error');
    for (const payment of [
      { ...input.payment, purchaseRef: '99999999-9999-4999-8999-999999999999' },
      { ...input.payment, amountKobo: 1 },
      { ...input.payment, purpose: 'vtu' },
    ])
      await expect(
        deliverPaidImeiLookup({ ...refunded, payment } as never, d)
      ).rejects.toBeInstanceOf(WalletPaymentMismatchError);
    expect(d.refund).not.toHaveBeenCalled();
  });
});

describe('bugfix: a lost delivery claim still refunded or showed a result (Codex P2)', () => {
  it('opens no refund and caches nothing when the failure was not recorded', async () => {
    const d = { ...deps('pending'), finish: vi.fn(async () => 'conflict') };
    const response = await deliverPaidImeiLookup(input, d);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'delivering' });
    expect(d.refund).not.toHaveBeenCalled();
    expect(cache.response).not.toHaveBeenCalled();
  });

  it('opens no refund when the database refuses it (a delivered check)', async () => {
    const d = {
      ...deps('pending'),
      finish: vi.fn(async () => {
        throw new Error('imei_wallet_payment_already_delivered');
      }),
    };
    const response = await deliverPaidImeiLookup(input, d);
    expect(response.status).toBe(202);
    expect(d.refund).not.toHaveBeenCalled();
  });
});

describe('bugfix: a result was shown after its delivery claim was lost (Codex P2)', () => {
  it('answers delivering instead of the result when the delivery was not recorded', async () => {
    cache.success.mockResolvedValue(
      new Response('{"status":"complete"}', { status: 200 })
    );
    const submit = vi.fn(async () => ({
      kind: 'complete',
      body: {},
      rawResponseText: 'x',
      providerStatus: 's',
      status: 200,
    }));
    const d = {
      ...deps('completed'),
      claim: vi.fn(async () => ({
        status: 'claimed' as const,
        purpose: 'imei_check' as const,
        purchaseRef: LOOKUP,
        amountKobo: 50000,
        claimToken: 'tok-1',
      })),
      finish: vi.fn(async () => 'conflict'),
      prepare: vi.fn(async () => ({
        binding: { provider: 'sickw' },
        provider: { submit },
        serviceTier: { checksIncluded: [], name: 'SIM lock' },
      })),
    };
    const response = await deliverPaidImeiLookup(input, d as never);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'delivering' });
  });
});
