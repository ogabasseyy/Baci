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

describe('wallet-funded shipment orchestration — quote and existing shipment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'provider_submitting'
    );
  });

  it('releases the lock when quote preparation fails before reservation', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const prepareQuote = vi
      .fn()
      .mockRejectedValue(
        new OrderShipmentBookingError(
          'Quote metadata unavailable',
          500,
          'QUOTE_METADATA_LOOKUP_FAILED'
        )
      );

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q-stale',
        'merchant_wallet',
        vi.fn(),
        release,
        prepareQuote
      )
    ).rejects.toMatchObject({ code: 'QUOTE_METADATA_LOOKUP_FAILED' });

    expect(release).toHaveBeenCalledOnce();
    expect(charge.reserveMerchantShippingCharge).not.toHaveBeenCalled();
  });

  it('refunds a resumed reservation when quote refresh fails before submission', async () => {
    const prepareQuote = vi
      .fn()
      .mockRejectedValue(new Error('refresh would replace active charge'));
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
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
    const book = vi.fn().mockResolvedValue({
      shipmentId: 's1',
      provider: 'GIGL' as const,
      providerShipmentId: 'p1',
      trackingNumber: 't1',
      carrierName: 'GIGL',
      quoteId: 'q1',
      estimatedDays: null,
      shipmentStatus: 'booked' as const,
    });

    await expect(
      bookWalletOrCustomerCheckout(
        supabase as never,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book,
        undefined,
        prepareQuote
      )
    ).rejects.toThrow('refresh would replace active charge');

    expect(prepareQuote).toHaveBeenCalledOnce();
    expect(charge.reserveMerchantShippingCharge).toHaveBeenCalledWith(
      supabase,
      'o1',
      'q1'
    );
    expect(charge.refundMerchantShippingCharge).toHaveBeenCalledWith(
      supabase,
      'charge-reserved',
      'r'.repeat(64),
      'QUOTE_REFRESH_FAILED'
    );
    expect(book).not.toHaveBeenCalled();
  });

  it('bugfix: does not refund provider_submitting charges when quote prep would fail', async () => {
    const prepareQuote = vi
      .fn()
      .mockRejectedValue(new Error('quote expired during retry'));
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    };
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'charge-submitting',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'provider_submitting',
      },
      token: 's'.repeat(64),
    });
    const book = vi.fn();

    await expect(
      bookWalletOrCustomerCheckout(
        supabase as never,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book,
        undefined,
        prepareQuote
      )
    ).rejects.toMatchObject({ code: 'SHIPMENT_BOOKING_IN_PROGRESS' });

    expect(prepareQuote).not.toHaveBeenCalled();
    expect(charge.refundMerchantShippingCharge).not.toHaveBeenCalled();
    expect(book).not.toHaveBeenCalled();
  });

  it('returns an existing booked shipment before preparing a quote', async () => {
    const existing = {
      shipmentId: 's-existing',
      provider: 'GIGL' as const,
      providerShipmentId: 'p-existing',
      trackingNumber: 't-existing',
      carrierName: 'GIGL',
      quoteId: 'q1',
      estimatedDays: null,
      shipmentStatus: 'booked' as const,
    };
    const prepareQuote = vi
      .fn()
      .mockRejectedValue(new Error('stale quote should not be prepared'));
    const readExistingShipment = vi.fn().mockResolvedValue(existing);
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'charge-reserved',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'reserved',
      },
      token: 'r'.repeat(64),
    });

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        vi.fn(),
        undefined,
        prepareQuote,
        readExistingShipment
      )
    ).resolves.toEqual(existing);

    expect(readExistingShipment).toHaveBeenCalledOnce();
    expect(prepareQuote).not.toHaveBeenCalled();
    expect(charge.reserveMerchantShippingCharge).toHaveBeenCalledOnce();
    expect(charge.completeMerchantShippingCharge).toHaveBeenCalledWith(
      supabaseFixture,
      'charge-reserved',
      'r'.repeat(64),
      's-existing'
    );
  });

  it('releases the lock and skips reservation when existing-shipment lookup fails', async () => {
    const release = vi.fn().mockRejectedValue(new Error('lock release failed'));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const readExistingShipment = vi
      .fn()
      .mockRejectedValue(
        new OrderShipmentBookingError(
          'Unable to verify existing shipment.',
          500,
          'EXISTING_SHIPMENT_LOOKUP_FAILED'
        )
      );

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        vi.fn(),
        release,
        undefined,
        readExistingShipment
      )
    ).rejects.toMatchObject({ code: 'EXISTING_SHIPMENT_LOOKUP_FAILED' });

    expect(release).toHaveBeenCalledOnce();
    expect(charge.reserveMerchantShippingCharge).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to release shipment booking lock after existing-shipment lookup error:',
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('rejects wallet booking when an existing shipment uses a different quote', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const readExistingShipment = vi.fn().mockResolvedValue({
      shipmentId: 's-existing',
      provider: 'GIGL' as const,
      providerShipmentId: 'p-existing',
      trackingNumber: 't-existing',
      carrierName: 'GIGL',
      quoteId: 'q-existing',
      estimatedDays: null,
      shipmentStatus: 'booked' as const,
    });

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        vi.fn(),
        release,
        undefined,
        readExistingShipment
      )
    ).rejects.toMatchObject({ code: 'EXISTING_SHIPMENT_QUOTE_MISMATCH' });

    expect(release).toHaveBeenCalledOnce();
    expect(charge.reserveMerchantShippingCharge).not.toHaveBeenCalled();
  });

  it('rejects wallet booking when an existing shipment uses a different provider', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const readExistingShipment = vi.fn().mockResolvedValue({
      shipmentId: 's-existing',
      provider: 'TOPSHIP' as const,
      providerShipmentId: 'p-existing',
      trackingNumber: 't-existing',
      carrierName: 'Topship',
      quoteId: 'q1',
      estimatedDays: null,
      shipmentStatus: 'booked' as const,
    });

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        vi.fn(),
        release,
        undefined,
        readExistingShipment
      )
    ).rejects.toMatchObject({ code: 'EXISTING_SHIPMENT_PROVIDER_MISMATCH' });

    expect(release).toHaveBeenCalledOnce();
    expect(charge.reserveMerchantShippingCharge).not.toHaveBeenCalled();
  });
});
