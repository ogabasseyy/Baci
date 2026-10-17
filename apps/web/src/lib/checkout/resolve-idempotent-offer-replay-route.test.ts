import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdempotentOfferReplayResolution } from './resolve-idempotent-offer-replay';
import { resolveOfferReplayForOrderRoute } from './resolve-idempotent-offer-replay-route';

const mocks = vi.hoisted(() => ({
  resolveIdempotentOfferReplay: vi.fn(),
}));

vi.mock('./resolve-idempotent-offer-replay', () => ({
  resolveIdempotentOfferReplay: mocks.resolveIdempotentOfferReplay,
}));

const VALUE: IdempotentOfferReplayResolution = {
  isIdempotentOfferOrderReplay: false,
  liveOfferConditions: new Map(),
  liveOfferPrices: new Map(),
  storedReplayDiscountAmount: null,
  storedReplayTaxAmount: null,
};

describe('resolveOfferReplayForOrderRoute', () => {
  beforeEach(() => {
    mocks.resolveIdempotentOfferReplay.mockReset();
  });

  it('returns the resolution on success', async () => {
    mocks.resolveIdempotentOfferReplay.mockResolvedValue({
      ok: true,
      value: VALUE,
    });

    const result = await resolveOfferReplayForOrderRoute({
      merchantId: 'merchant-1',
      orderItemsPayload: [],
      requestIdempotencyKey: null,
      supabase: {} as never,
    });

    expect(result).toEqual({ ok: true, value: VALUE });
  });

  it('maps verification failures to a 500 response', async () => {
    const error = new Error('rpc down');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resolveIdempotentOfferReplay.mockResolvedValue({
      ok: false,
      reason: 'verification_failed',
      error,
    });

    try {
      const result = await resolveOfferReplayForOrderRoute({
        merchantId: 'merchant-1',
        orderItemsPayload: [],
        requestIdempotencyKey: null,
        supabase: {} as never,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(500);
        expect(await result.response.json()).toEqual({
          error: 'Failed to verify order offers',
        });
      }
      expect(consoleSpy).toHaveBeenCalledWith(
        'Order offer verification failed:',
        error
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('maps invalid offers to a 400 response', async () => {
    mocks.resolveIdempotentOfferReplay.mockResolvedValue({
      ok: false,
      reason: 'invalid_offer',
    });

    const result = await resolveOfferReplayForOrderRoute({
      merchantId: 'merchant-1',
      orderItemsPayload: [],
      requestIdempotencyKey: null,
      supabase: {} as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({
        error: 'Invalid condition offer for order item',
      });
    }
  });
});
