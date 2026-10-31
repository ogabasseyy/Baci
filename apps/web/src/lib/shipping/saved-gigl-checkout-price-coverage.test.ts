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
  provider_cost: 1000,
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

  it('logs only amounts and internal ids for reconciliation', () => {
    assertSavedGiglCheckoutPriceCovered(saved, [{ providerCost: 900 }]);
    expect(logger.info).toHaveBeenCalledWith({
      message: 'Saved GIG checkout quote price check',
      quoteId: 'saved-quote',
      merchantId: 'merchant',
      currency: 'NGN',
      paidPrice: 1100,
      savedProviderCost: 1000,
      liveProviderCost: 900,
      covered: true,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('refuses when GIG now charges more than the customer paid, naming both amounts', () => {
    expect(() =>
      assertSavedGiglCheckoutPriceCovered(saved, [{ providerCost: 1250 }])
    ).toThrow(
      expect.objectContaining({
        code: GIGL_COST_EXCEEDS_CUSTOMER_PAID,
        status: 409,
        message:
          'GIG now charges ₦1,250 to deliver this order, more than the ₦1,100 the customer paid. No booking was made.',
      })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        liveProviderCost: 1250,
        paidPrice: 1100,
        covered: false,
      })
    );
  });

  it('shows kobo when either amount is fractional', () => {
    expect(() =>
      assertSavedGiglCheckoutPriceCovered({ ...saved, price: '1100.5' }, [
        { providerCost: 1100.75 },
      ])
    ).toThrow(
      'GIG now charges ₦1,100.75 to deliver this order, more than the ₦1,100.50 the customer paid. No booking was made.'
    );
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
