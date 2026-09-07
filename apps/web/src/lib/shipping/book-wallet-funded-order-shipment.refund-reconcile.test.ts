import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./merchant-shipping-charge', () => ({
  reserveMerchantShippingCharge: vi.fn(),
  beginMerchantShippingChargeSubmission: vi.fn(),
  completeMerchantShippingCharge: vi.fn(),
  recoverMerchantShippingChargeForPersistedShipment: vi.fn(),
  refundMerchantShippingCharge: vi.fn(),
  markMerchantShippingChargeForReconciliation: vi.fn(),
}));

import { supabaseFixture } from './book-wallet-funded-order-shipment.test-support';
import { bookWalletOrCustomerCheckout } from './book-wallet-or-customer-checkout';
import * as charge from './merchant-shipping-charge';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

describe('wallet-funded shipment orchestration — refund and reconcile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'provider_submitting'
    );
  });

  it('persists provider reference when local shipment save fails after provider booking', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-provider-ref',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'p'.repeat(64),
    });
    const providerSaveFailure = new OrderShipmentBookingError(
      'Shipment booked with GIGL but could not be saved locally. Tracking: TRK-1',
      500,
      'SHIPMENT_SAVE_FAILED',
      'provider-shipment-1'
    );
    const book = vi.fn().mockRejectedValue(providerSaveFailure);

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book
      )
    ).rejects.toMatchObject({ code: 'SHIPMENT_SAVE_FAILED' });

    expect(
      charge.markMerchantShippingChargeForReconciliation
    ).toHaveBeenCalledWith(
      expect.anything(),
      'c-provider-ref',
      'p'.repeat(64),
      'SHIPMENT_SAVE_FAILED',
      'provider-shipment-1'
    );
  });

  it('releases the booking lock only for definitive failures', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c3',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'd'.repeat(64),
    });
    const definitive = vi
      .fn()
      .mockRejectedValue(
        new OrderShipmentBookingError('bad quote', 400, 'QUOTE_NOT_FOUND')
      );
    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        definitive,
        release
      )
    ).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();

    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c4',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'e'.repeat(64),
    });
    const timeout = vi
      .fn()
      .mockRejectedValue(
        new OrderShipmentBookingError('timeout', 504, 'PROVIDER_TIMEOUT')
      );
    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        timeout,
        release
      )
    ).rejects.toThrow();
    expect(release).toHaveBeenCalledOnce();
  });

  it('refunds once and releases the lock when wallet quote reconfirmation is required', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-requote',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'r'.repeat(64),
    });
    const book = vi
      .fn()
      .mockRejectedValue(
        new OrderShipmentBookingError(
          'Please reconfirm shipping',
          409,
          'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED'
        )
      );

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book,
        release
      )
    ).rejects.toMatchObject({
      code: 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED',
    });

    expect(charge.refundMerchantShippingCharge).toHaveBeenCalledTimes(1);
    expect(
      charge.markMerchantShippingChargeForReconciliation
    ).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
