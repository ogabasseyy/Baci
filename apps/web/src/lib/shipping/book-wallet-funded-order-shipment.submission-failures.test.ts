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

describe('wallet-funded shipment orchestration — submission failures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'provider_submitting'
    );
  });

  it('refunds and releases the lock when submission cannot begin before provider booking', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-submit',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 's'.repeat(64),
    });
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockRejectedValue(
      new OrderShipmentBookingError(
        'Unable to begin shipment submission.',
        500,
        'MERCHANT_WALLET_SUBMISSION_FAILED'
      )
    );
    const book = vi.fn();

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
    ).rejects.toMatchObject({ code: 'MERCHANT_WALLET_SUBMISSION_FAILED' });

    expect(book).not.toHaveBeenCalled();
    expect(charge.refundMerchantShippingCharge).toHaveBeenCalledWith(
      expect.anything(),
      'c-submit',
      's'.repeat(64),
      'MERCHANT_WALLET_SUBMISSION_FAILED'
    );
    expect(
      charge.markMerchantShippingChargeForReconciliation
    ).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not call GIGL when begin submission returns refunded without an RPC error', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-refunded',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'r'.repeat(64),
    });
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'refunded'
    );
    const book = vi.fn();

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
    ).rejects.toMatchObject({ code: 'MERCHANT_WALLET_CHARGE_REFUNDED' });

    expect(book).not.toHaveBeenCalled();
    expect(charge.refundMerchantShippingCharge).toHaveBeenCalledWith(
      expect.anything(),
      'c-refunded',
      'r'.repeat(64),
      'MERCHANT_WALLET_CHARGE_REFUNDED'
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('refunds definitive rejection but reconciles ambiguous failures', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c1',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'b'.repeat(64),
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
        definitive
      )
    ).rejects.toThrow();
    expect(charge.refundMerchantShippingCharge).toHaveBeenCalled();
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c2',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'c'.repeat(64),
    });
    const ambiguous = vi
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
        ambiguous
      )
    ).rejects.toThrow();
    expect(
      charge.markMerchantShippingChargeForReconciliation
    ).toHaveBeenCalled();
  });
});
