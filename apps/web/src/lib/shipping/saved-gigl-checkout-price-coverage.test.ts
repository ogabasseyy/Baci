import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import {
  assertSavedGiglCheckoutPriceCovered,
  GIGL_COST_EXCEEDS_CUSTOMER_PAID,
} from './saved-gigl-checkout-price-coverage';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const saved = {
  id: 'saved-quote',
  merchant_id: 'merchant',
  price: 1100,
  currency: 'NGN',
};

describe('assertSavedGiglCheckoutPriceCovered', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    900, 1000, 1099.99, 1100,
  ])('accepts a live GIG cost of %s within the 1100 the customer paid', (liveCost) => {
    expect(() =>
      assertSavedGiglCheckoutPriceCovered(saved, [{ providerCost: liveCost }])
    ).not.toThrow();
  });

  it('logs the verdict, ids, currency and paid price for reconciliation', () => {
    assertSavedGiglCheckoutPriceCovered(saved, [{ providerCost: 900 }]);
    expect(logger.info).toHaveBeenCalledWith({
      message: 'Saved GIG checkout quote price check',
      quoteId: 'saved-quote',
      merchantId: 'merchant',
      currency: 'NGN',
      paidPrice: 1100,
      covered: true,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('refuses when GIG now charges more than the customer paid, naming only the paid price', () => {
    expect(() =>
      assertSavedGiglCheckoutPriceCovered(saved, [{ providerCost: 1250 }])
    ).toThrow(
      expect.objectContaining({
        code: GIGL_COST_EXCEEDS_CUSTOMER_PAID,
        status: 409,
        message:
          "GIG's current price for this delivery is higher than the ₦1,100 the customer paid. No booking was made.",
      })
    );
    expect(logger.warn).toHaveBeenCalledWith({
      message: 'Saved GIG checkout quote price check',
      quoteId: 'saved-quote',
      merchantId: 'merchant',
      currency: 'NGN',
      paidPrice: 1100,
      covered: false,
    });
  });

  it('shows kobo when the paid price is fractional', () => {
    expect(() =>
      assertSavedGiglCheckoutPriceCovered({ ...saved, price: '1100.5' }, [
        { providerCost: 1100.75 },
      ])
    ).toThrow(
      "GIG's current price for this delivery is higher than the ₦1,100.50 the customer paid. No booking was made."
    );
  });

  it.each([
    ['covered', 1037.25, false],
    ['uncovered', 1234.56, true],
  ])('bugfix: never puts GIG tariffs or margin in logs or the error when %s', (_case, liveCost, refused) => {
    const internal = {
      ...saved,
      provider_cost: 987.65,
      platform_margin: 112.35,
    };
    let error: unknown;
    try {
      assertSavedGiglCheckoutPriceCovered(internal, [
        { providerCost: liveCost },
      ]);
    } catch (caught) {
      error = caught;
    }
    const logged = JSON.stringify([
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
    ]);
    expect(error !== undefined).toBe(refused);
    const message = error instanceof Error ? error.message : '';
    for (const leak of [
      String(liveCost),
      liveCost.toLocaleString('en-NG'),
      '987.65',
      '987',
      '112.35',
      '112',
    ]) {
      expect(logged).not.toContain(leak);
      expect(message).not.toContain(leak);
    }
    expect(logged).not.toMatch(/cost|margin/i);
  });

  it('uses the dearest live row when GIG returns the same service twice', () => {
    expect(() =>
      assertSavedGiglCheckoutPriceCovered(saved, [
        { providerCost: 900 },
        { providerCost: 1200 },
      ])
    ).toThrow(
      expect.objectContaining({ code: GIGL_COST_EXCEEDS_CUSTOMER_PAID })
    );
  });

  it.each([
    [[]],
    [[{ providerCost: undefined }]],
    [[{ providerCost: 0 }]],
    [[{ providerCost: Number.NaN }]],
    [[{ providerCost: 900 }, { providerCost: undefined }]],
  ])('reports an unverifiable live cost as a retryable price-check failure %j', (candidates) => {
    expect(() =>
      assertSavedGiglCheckoutPriceCovered(saved, candidates)
    ).toThrow(
      expect.objectContaining({ code: 'QUOTE_REFRESH_FAILED', status: 409 })
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});
