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
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { ShippingBookingRejectedError } from './types';

describe('wallet-funded shipment orchestration — failure state handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'provider_submitting'
    );
  });

  it('bugfix: keeps the provider error when freeing the lock fails after a never-reached refund', async () => {
    const release = vi.fn().mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-release-fail',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'r'.repeat(64),
    });
    const unreachable = new OrderShipmentBookingError(
      'quote mismatch',
      409,
      'SHIPPING_QUOTE_RECEIVER_MISMATCH'
    );
    const book = vi.fn().mockRejectedValue(unreachable);

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
    ).rejects.toBe(unreachable);

    expect(release).toHaveBeenCalledOnce();
  });

  it('bugfix: passes the carrier reference of a Topship payment refusal to wallet reconciliation', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-topship-ref',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 't'.repeat(64),
    });
    const book = vi
      .fn()
      .mockRejectedValue(new ShippingBookingRejectedError('refused', 'T1'));

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book,
        vi.fn()
      )
    ).rejects.toBeInstanceOf(ShippingBookingRejectedError);

    expect(
      charge.markMerchantShippingChargeForReconciliation
    ).toHaveBeenCalledWith(
      expect.anything(),
      'c-topship-ref',
      't'.repeat(64),
      'UNKNOWN_PROVIDER_FAILURE',
      'T1'
    );
  });

  it('bugfix: keeps the provider error and the lock when the refund RPC fails after an unreachable carrier', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const release = vi.fn();
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-refund-fail',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'f'.repeat(64),
    });
    vi.mocked(charge.refundMerchantShippingCharge).mockRejectedValue(
      new Error('refund rpc down')
    );
    const unreachable = new OrderShipmentBookingError(
      'quote mismatch',
      409,
      'SHIPPING_QUOTE_RECEIVER_MISMATCH'
    );

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        vi.fn().mockRejectedValue(unreachable),
        release
      )
    ).rejects.toBe(unreachable);

    expect(release).not.toHaveBeenCalled();
    expect(
      charge.markMerchantShippingChargeForReconciliation
    ).toHaveBeenCalledOnce();
    // The outer cleanup must not free the lock either.
    expect(shouldReleaseBookingLock(unreachable)).toBe(false);
  });

  it('bugfix: reconciles a completion failure with the carrier reference of the booked shipment', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-complete-fail',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'k'.repeat(64),
    });
    vi.mocked(charge.completeMerchantShippingCharge).mockRejectedValue(
      new OrderShipmentBookingError(
        'completion failed',
        500,
        'MERCHANT_WALLET_COMPLETION_FAILED'
      )
    );
    const book = vi.fn().mockResolvedValue({
      shipmentId: 'ship-1',
      providerShipmentId: 'GIGL-9',
      trackingNumber: 'GIGL-9',
    });

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book,
        vi.fn()
      )
    ).rejects.toMatchObject({ code: 'MERCHANT_WALLET_COMPLETION_FAILED' });

    expect(
      charge.markMerchantShippingChargeForReconciliation
    ).toHaveBeenCalledWith(
      expect.anything(),
      'c-complete-fail',
      'k'.repeat(64),
      'MERCHANT_WALLET_COMPLETION_FAILED',
      'GIGL-9'
    );
  });
});
