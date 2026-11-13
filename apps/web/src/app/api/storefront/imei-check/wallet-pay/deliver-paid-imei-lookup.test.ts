import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverPaidImeiLookup,
  WalletPaymentMismatchError,
} from './deliver-paid-imei-lookup';

vi.mock('server-only', () => ({}));
const cache = vi.hoisted(() => ({ success: vi.fn(), response: vi.fn() }));
vi.mock('../route-cache-helpers', () => ({
  cacheSuccessfulLookup: cache.success,
  cacheLookupResponse: cache.response,
}));

const LOOKUP = '11111111-1111-4111-8111-111111111111';
const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const lookup = {
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
};
const submit = vi.fn();
const order: string[] = [];
function deps(overrides: Record<string, unknown> = {}) {
  return {
    claim: vi.fn(async () => ({
      status: 'claimed' as const,
      purpose: 'imei_check' as const,
      purchaseRef: LOOKUP,
      amountKobo: 50000,
      claimToken: 'tok-1',
    })),
    finish: vi.fn(async (_op: string, outcome: string, _token: string) => {
      order.push(`finish:${outcome}`);
      return outcome === 'fulfilled'
        ? ('fulfilled' as const)
        : ('refund_owed' as const);
    }),
    refund: vi.fn(async () => {
      order.push('refund');
      return 'pending' as const;
    }),
    readStatus: vi.fn(async () => 'completed'),
    prepare: vi.fn(async () => ({
      binding: { provider: 'sickw' },
      provider: { submit },
      serviceTier: { checksIncluded: [], name: 'SIM lock' },
    })),
    ...overrides,
  };
}
const base = {
  lookup,
  operationId: OP,
  normalizedImei: '356938035643809',
  supabaseAdmin: {} as never,
  payment: { purpose: 'imei_check', purchaseRef: LOOKUP, amountKobo: 50000 },
};

beforeEach(() => {
  vi.resetAllMocks();
  order.length = 0;
  cache.success.mockImplementation(async () => {
    order.push('cache:completed');
    return new Response(JSON.stringify({ status: 'complete' }), {
      status: 200,
    });
  });
  cache.response.mockImplementation(
    async ({ terminalStatus }: { terminalStatus: string }) => {
      order.push(`cache:${terminalStatus}`);
    }
  );
});

describe('deliverPaidImeiLookup', () => {
  it('runs the lookup once for a confirmed, claimed payment, caching before marking it delivered', async () => {
    submit.mockResolvedValue({
      kind: 'complete',
      body: {},
      rawResponseText: 'x',
      providerStatus: 's',
      status: 200,
    });
    const d = deps();
    const response = await deliverPaidImeiLookup(base, d);
    expect(response.status).toBe(200);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['cache:completed', 'finish:fulfilled']);
    expect(d.finish).toHaveBeenCalledWith(OP, 'fulfilled', 'tok-1');
    expect(d.refund).not.toHaveBeenCalled();
  });

  it('refunds exactly once on a definitive lookup failure, opening the refund before caching it', async () => {
    submit.mockResolvedValue({
      kind: 'failure',
      body: { code: 'NOT_FOUND', error: 'x', success: false },
      providerStatus: 'n',
      refundReason: 'not_found',
      status: 404,
    });
    const d = deps();
    const response = await deliverPaidImeiLookup(base, d);
    expect(response.status).toBe(404);
    expect(order).toEqual([
      'finish:failed',
      'refund',
      'cache:refunded_not_found',
    ]);
    expect(d.refund).toHaveBeenCalledTimes(1);
  });

  it('does not deliver an unconfirmed payment', async () => {
    const d = deps({
      claim: vi.fn(async () => ({ status: 'not_confirmed' as const })),
    });
    const response = await deliverPaidImeiLookup(base, d);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'payment_pending',
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('never runs a second lookup while another request is delivering', async () => {
    const d = deps({ claim: vi.fn(async () => ({ status: 'busy' as const })) });
    const response = await deliverPaidImeiLookup(base, d);
    expect(response.status).toBe(202);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses a payment issued for another lookup', async () => {
    const d = deps({
      claim: vi.fn(async () => ({
        status: 'claimed' as const,
        purpose: 'imei_check' as const,
        purchaseRef: '99999999-9999-4999-8999-999999999999',
        amountKobo: 50000,
        claimToken: 'tok-1',
      })),
    });
    await expect(deliverPaidImeiLookup(base, d)).rejects.toBeInstanceOf(
      WalletPaymentMismatchError
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('finishes delivery without a second lookup when the result was already saved', async () => {
    const d = deps();
    const response = await deliverPaidImeiLookup(
      {
        ...base,
        lookup: {
          ...lookup,
          status: 'completed',
          cached_response: { status: 'complete' } as never,
          cached_status: 200,
        },
      },
      d
    );
    expect(response.status).toBe(200);
    expect(d.claim).toHaveBeenCalledWith(OP);
    expect(d.finish).toHaveBeenCalledWith(OP, 'fulfilled', 'tok-1');
    expect(submit).not.toHaveBeenCalled();
  });

  it('bugfix: never records a foreign payment as delivered by a saved result (Muse)', async () => {
    const d = deps({
      claim: vi.fn(async () => ({
        status: 'claimed' as const,
        purpose: 'imei_check' as const,
        purchaseRef: 'another-lookup',
        amountKobo: 50000,
        claimToken: 'tok-1',
      })),
    });
    await deliverPaidImeiLookup(
      {
        ...base,
        lookup: {
          ...lookup,
          status: 'completed',
          cached_response: { status: 'complete' } as never,
          cached_status: 200,
        },
      },
      d
    );
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('refunds when the tier can no longer be served by Sickw', async () => {
    const d = deps({
      prepare: vi.fn(async () => ({
        binding: { provider: 'petrock' },
        provider: { submit },
        serviceTier: {},
      })),
    });
    const response = await deliverPaidImeiLookup(base, d);
    expect(response.status).toBe(502);
    expect(order).toEqual(['finish:failed', 'refund', 'cache:refunded_error']);
    expect(submit).not.toHaveBeenCalled();
  });
  it('refunds a reclaimed delivery instead of buying the Sickw check twice', async () => {
    const d = deps({
      claim: vi.fn(async () => ({
        status: 'reclaimed' as const,
        purpose: 'imei_check' as const,
        purchaseRef: LOOKUP,
        amountKobo: 50000,
        claimToken: 'tok-2',
      })),
      readStatus: vi.fn(async () => 'pending'),
    });
    const response = await deliverPaidImeiLookup(base, d);
    expect(response.status).toBe(502);
    expect(submit).not.toHaveBeenCalled();
    expect(order).toEqual(['finish:failed', 'refund', 'cache:refunded_error']);
    expect(d.finish).toHaveBeenCalledWith(OP, 'failed', 'tok-2');
  });

  it('persists the refunded outcome when an earlier refund cache write was lost', async () => {
    for (const status of ['refund_owed', 'refunded'] as const) {
      order.length = 0;
      const d = deps({ claim: vi.fn(async () => ({ status })) });
      const response = await deliverPaidImeiLookup(base, d);
      expect(response.status).toBe(502);
      expect(order).toEqual(['cache:refunded_error']);
      expect(d.finish).not.toHaveBeenCalled();
    }
  });

  it('bugfix: never shows (or records) a result that was not durably saved (Muse high)', async () => {
    submit.mockResolvedValue({
      kind: 'complete',
      body: {},
      rawResponseText: 'x',
      providerStatus: 's',
      status: 200,
    });
    const d = deps({ readStatus: vi.fn(async () => 'pending') });
    const response = await deliverPaidImeiLookup(base, d);
    // Still delivering: a later reclaim finds it saved or refunds.
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'delivering' });
    expect(d.finish).not.toHaveBeenCalled();
  });

  it('retries recording a failed delivery once before refunding', async () => {
    submit.mockResolvedValue({
      kind: 'failure',
      body: { code: 'ERR', error: 'x', success: false },
      providerStatus: 'e',
      refundReason: 'error',
      status: 502,
    });
    const finish = vi
      .fn()
      .mockRejectedValueOnce(new Error('db'))
      .mockImplementation(async (_op: string, outcome: string) => {
        order.push(`finish:${outcome}`);
        return 'refund_owed';
      });
    const d = deps({ finish });
    await deliverPaidImeiLookup(base, d);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['finish:failed', 'refund', 'cache:refunded_error']);
  });
  it('refunds (never strands the claim) on an unexpected provider answer', async () => {
    submit.mockResolvedValue({ kind: 'pending', body: {}, status: 202 });
    const d = deps();
    const response = await deliverPaidImeiLookup(base, d);
    expect(response.status).toBe(502);
    expect(order).toEqual(['finish:failed', 'refund', 'cache:refunded_error']);
  });
  it('retries a refund still owed when the customer returns to a refunded check', async () => {
    const d = deps();
    const response = await deliverPaidImeiLookup(
      {
        ...base,
        lookup: {
          ...lookup,
          status: 'refunded_error',
          cached_response: { status: 'error' } as never,
          cached_status: 502,
        },
      },
      d
    );
    expect(response.status).toBe(502);
    expect(d.refund).toHaveBeenCalledWith(OP);
    expect(d.claim).not.toHaveBeenCalled();
  });

  describe('bugfix: review round four (#4220)', () => {
    it('refuses a claimed payment whose amount is not the lookup price, before buying the check', async () => {
      const d = deps({
        claim: vi.fn(async () => ({
          status: 'claimed' as const,
          purpose: 'imei_check' as const,
          purchaseRef: LOOKUP,
          amountKobo: 49999,
          claimToken: 'tok-1',
        })),
      });
      await expect(deliverPaidImeiLookup(base, d)).rejects.toBeInstanceOf(
        WalletPaymentMismatchError
      );
      expect(submit).not.toHaveBeenCalled();
    });

    it('raises an unknown claim status instead of answering delivering', async () => {
      const d = deps({ claim: vi.fn(async () => ({ status: 'mystery' })) });
      await expect(deliverPaidImeiLookup(base, d)).rejects.toThrow(
        'Unexpected wallet payment claim status'
      );
      expect(submit).not.toHaveBeenCalled();
    });
  });
});
