import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverPaidImeiLookup } from './deliver-paid-imei-lookup';

vi.mock('server-only', () => ({}));
const cache = vi.hoisted(() => ({ response: vi.fn() }));
vi.mock('../route-cache-helpers', () => ({
  cacheSuccessfulLookup: vi.fn(),
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
};
const deps = (savedStatus: string) => ({
  claim: vi.fn(async () => ({
    status: 'reclaimed' as const,
    purpose: 'imei_check' as const,
    purchaseRef: LOOKUP,
    amountKobo: 50000,
    claimToken: 'tok-2',
  })),
  finish: vi.fn(async () => 'fulfilled'),
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
