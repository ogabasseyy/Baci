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

describe('finalizeWalletFundedExistingShipment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'provider_submitting'
    );
  });

  it('completes the wallet charge before returning a reusable shipment', async () => {
    const existing = {
      shipmentId: 's-existing',
      provider: 'GIGL' as const,
      providerShipmentId: 'p-existing',
      trackingNumber: 't-existing',
      carrierName: 'GIGL',
      quoteId: 'q-existing',
      estimatedDays: null,
      shipmentStatus: 'booked' as const,
    };
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'charge-reserved',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'r'.repeat(64),
    });
    const readExistingShipment = vi.fn().mockResolvedValue(existing);
    const book = vi.fn();

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q-existing',
        'merchant_wallet',
        book,
        undefined,
        undefined,
        readExistingShipment
      )
    ).resolves.toEqual(existing);

    expect(charge.beginMerchantShippingChargeSubmission).toHaveBeenCalledWith(
      supabaseFixture,
      'charge-reserved',
      'r'.repeat(64)
    );
    expect(charge.completeMerchantShippingCharge).toHaveBeenCalledWith(
      supabaseFixture,
      'charge-reserved',
      'r'.repeat(64),
      's-existing'
    );
    expect(book).not.toHaveBeenCalled();
  });
});
