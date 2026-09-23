import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isFundedCheckoutGiglAddressLocked } from './is-funded-checkout-gigl-address-locked';

vi.mock('@/lib/shipping/load-order-gigl-settled-retained-amount', () => ({
  loadOrderGiglSettledRetainedAmount: vi.fn(),
}));
vi.mock(
  '@/lib/shipping/load-order-gigl-internal-credit-retained-amount',
  () => ({
    loadOrderGiglInternalCreditRetainedAmount: vi.fn(),
  })
);

import { loadOrderGiglInternalCreditRetainedAmount } from '@/lib/shipping/load-order-gigl-internal-credit-retained-amount';
import { loadOrderGiglSettledRetainedAmount } from '@/lib/shipping/load-order-gigl-settled-retained-amount';

describe('isFundedCheckoutGiglAddressLocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOrderGiglInternalCreditRetainedAmount).mockResolvedValue(0);
  });

  it('locks when settled retention is positive', async () => {
    vi.mocked(loadOrderGiglSettledRetainedAmount).mockResolvedValue(2500);

    await expect(
      isFundedCheckoutGiglAddressLocked(
        { from: vi.fn() } as never,
        'merchant-1',
        'order-1',
        {
          shipping_provider: 'GIGL',
          payment_status: 'paid',
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 2500,
          selected_quote_id: 'quote-1',
        }
      )
    ).resolves.toBe(true);

    expect(loadOrderGiglSettledRetainedAmount).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      'order-1'
    );
    expect(loadOrderGiglInternalCreditRetainedAmount).not.toHaveBeenCalled();
  });

  it('bugfix: skips internal-credit RPC when settlements lock without a tariff stamp', async () => {
    vi.mocked(loadOrderGiglSettledRetainedAmount).mockResolvedValue(2500);

    await expect(
      isFundedCheckoutGiglAddressLocked(
        { from: vi.fn() } as never,
        'merchant-1',
        'order-1',
        {
          shipping_provider: 'GIGL',
          payment_status: 'paid',
          shipping_funding_source: 'customer_checkout',
          selected_quote_id: 'quote-1',
        }
      )
    ).resolves.toBe(true);

    expect(loadOrderGiglInternalCreditRetainedAmount).not.toHaveBeenCalled();
  });

  it('bugfix: locks when only internal-credit funding retains shipping', async () => {
    vi.mocked(loadOrderGiglSettledRetainedAmount).mockResolvedValue(0);
    vi.mocked(loadOrderGiglInternalCreditRetainedAmount).mockResolvedValue(
      5000
    );

    await expect(
      isFundedCheckoutGiglAddressLocked(
        { from: vi.fn() } as never,
        'merchant-1',
        'order-1',
        {
          shipping_provider: 'GIGL',
          payment_status: 'paid',
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 2500,
          selected_quote_id: 'quote-1',
        }
      )
    ).resolves.toBe(true);
  });

  it('bugfix: does not lock quiz_voucher / zero-settlement checkout with stamped quote retention', async () => {
    // Stamp trigger can project positive retained amount via quote economics,
    // but no merchant_settlements or internal-credit row retains shipping.
    vi.mocked(loadOrderGiglSettledRetainedAmount).mockResolvedValue(0);

    await expect(
      isFundedCheckoutGiglAddressLocked(
        { from: vi.fn() } as never,
        'merchant-1',
        'order-1',
        {
          shipping_provider: 'GIGL',
          payment_status: 'paid',
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 2500,
          selected_quote_id: 'quote-1',
        }
      )
    ).resolves.toBe(false);
  });

  it('skips settled retention when the order is not a checkout-funded GIGL shipment', async () => {
    await expect(
      isFundedCheckoutGiglAddressLocked(
        { from: vi.fn() } as never,
        'merchant-1',
        'order-1',
        {
          shipping_provider: 'GIGL',
          payment_status: 'paid',
          shipping_funding_source: 'merchant_wallet',
          selected_quote_id: 'quote-1',
        }
      )
    ).resolves.toBe(false);

    expect(loadOrderGiglSettledRetainedAmount).not.toHaveBeenCalled();
  });

  it('bugfix: locks partially_paid checkout orders that already retained shipping', async () => {
    vi.mocked(loadOrderGiglSettledRetainedAmount).mockResolvedValue(2500);

    await expect(
      isFundedCheckoutGiglAddressLocked(
        { from: vi.fn() } as never,
        'merchant-1',
        'order-1',
        {
          shipping_provider: 'GIGL',
          payment_status: 'partially_paid',
          shipping_funding_source: 'customer_checkout',
          shipping_platform_retained_amount: 2500,
          selected_quote_id: 'quote-1',
        }
      )
    ).resolves.toBe(true);

    expect(loadOrderGiglSettledRetainedAmount).toHaveBeenCalled();
  });
});
