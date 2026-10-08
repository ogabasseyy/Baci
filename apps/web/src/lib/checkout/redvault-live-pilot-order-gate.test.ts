import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateMocks = vi.hoisted(() => ({
  getRedvaultPaymentAvailability: vi.fn(),
  validateRedvaultLivePilotOrder: vi.fn(),
}));

vi.mock('@/lib/checkout/redvault-payment-availability', () => ({
  getRedvaultPaymentAvailability: gateMocks.getRedvaultPaymentAvailability,
}));
vi.mock('@/lib/checkout/redvault-live-pilot', () => ({
  validateRedvaultLivePilotOrder: gateMocks.validateRedvaultLivePilotOrder,
}));

import { rejectDisallowedRedvaultLivePilotOrder } from './redvault-live-pilot-order-gate';

const quote = {
  discountKobo: 500,
  eligibleSubtotalKobo: 10_000,
  groups: [],
  lines: [{ unitPriceKobo: 10_000 }],
  productSubtotalKobo: 10_000,
} as unknown as Parameters<
  typeof rejectDisallowedRedvaultLivePilotOrder
>[0]['redvaultQuote'];

const baseInput = {
  redvaultRequested: true,
  redvaultQuote: quote,
  userId: 'user',
  merchantId: 'merchant',
  currency: 'NGN',
  shippingFee: 0,
  wrappingFee: 0,
  orderItems: [{ assurance_fee: 100 }, { assurance_fee: 50 }],
  useWalletCredit: true,
  walletAmount: '200',
  useSavingsCredit: false,
  savingsAmount: 999,
  taxAmount: 7.5,
};

describe('rejectDisallowedRedvaultLivePilotOrder', () => {
  beforeEach(() => {
    gateMocks.getRedvaultPaymentAvailability.mockReset();
    gateMocks.validateRedvaultLivePilotOrder.mockReset();
    gateMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'private_live_pilot',
    });
    gateMocks.validateRedvaultLivePilotOrder.mockReturnValue(true);
  });

  it('passes through when REDVAULT was not requested', () => {
    expect(
      rejectDisallowedRedvaultLivePilotOrder({
        ...baseInput,
        redvaultRequested: false,
      })
    ).toBeNull();
    expect(gateMocks.validateRedvaultLivePilotOrder).not.toHaveBeenCalled();
  });

  it('passes through outside the live pilot', () => {
    gateMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'staging_test_mode',
    });
    expect(rejectDisallowedRedvaultLivePilotOrder(baseInput)).toBeNull();
    expect(gateMocks.validateRedvaultLivePilotOrder).not.toHaveBeenCalled();
  });

  it('aggregates fees and passes the order through when valid', () => {
    expect(rejectDisallowedRedvaultLivePilotOrder(baseInput)).toBeNull();
    expect(gateMocks.validateRedvaultLivePilotOrder).toHaveBeenCalledWith({
      userId: 'user',
      merchantId: 'merchant',
      currency: 'NGN',
      items: quote?.lines,
      subtotalKobo: 10_000,
      discountKobo: 500,
      shippingFee: 0,
      assuranceAmount: 150,
      wrappingFee: 0,
      walletAmount: 200,
      savingsAmount: 0,
      taxAmountKobo: 750,
    });
  });

  it('rejects with 409 when the pilot validation fails', async () => {
    gateMocks.validateRedvaultLivePilotOrder.mockReturnValue(false);
    const response = rejectDisallowedRedvaultLivePilotOrder(baseInput);
    expect(response?.status).toBe(409);
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    await expect(response?.json()).resolves.toEqual({
      code: 'REDVAULT_PILOT_UNAVAILABLE',
      error: 'REDVAULT is unavailable',
    });
  });
});
