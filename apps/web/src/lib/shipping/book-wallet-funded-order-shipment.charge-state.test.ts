import type { SupabaseClient } from '@supabase/supabase-js';
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

describe('wallet-funded shipment orchestration — charge state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(charge.beginMerchantShippingChargeSubmission).mockResolvedValue(
      'provider_submitting'
    );
  });

  it('returns an existing booked shipment without beginning another provider attempt', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c5',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'booked',
      },
      token: 'f'.repeat(64),
    });
    const existing = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        const result =
          table === 'merchant_shipping_charges'
            ? { shipment_id: 's-existing' }
            : {
                id: 's-existing',
                provider: 'GIGL',
                provider_shipment_id: 'p-existing',
                shipping_quote_id: 'q1',
                tracking_number: 't-existing',
                carrier_name: 'GIGL',
                estimated_delivery_days: null,
                label_url: null,
                pickup_scheduled_at: null,
                status: 'booked',
              };
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: result, error: null }),
        };
      }),
    } as unknown as SupabaseClient;

    await expect(
      bookWalletOrCustomerCheckout(
        supabase,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        existing
      )
    ).resolves.toMatchObject({ shipmentId: 's-existing' });
    expect(existing).not.toHaveBeenCalled();
    expect(charge.beginMerchantShippingChargeSubmission).not.toHaveBeenCalled();
  });

  it('releases the lock when a prior wallet charge was already refunded', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c-refunded',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'refunded',
      },
      token: 'h'.repeat(64),
    });
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
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails closed for a possibly-started provider submission', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c6',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'provider_submitting',
      },
      token: 'g'.repeat(64),
    });
    const book = vi.fn();
    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book
      )
    ).rejects.toMatchObject({ code: 'SHIPMENT_BOOKING_IN_PROGRESS' });
    expect(book).not.toHaveBeenCalled();
    expect(charge.beginMerchantShippingChargeSubmission).not.toHaveBeenCalled();
  });

  it('completes a provider_submitting charge when the shipment was already persisted', async () => {
    vi.mocked(charge.reserveMerchantShippingCharge).mockResolvedValue({
      charge: {
        chargeId: 'c7',
        chargedAmount: 100,
        balanceAfter: 0,
        status: 'provider_submitting',
      },
      token: 'i'.repeat(64),
    });
    vi.mocked(
      charge.recoverMerchantShippingChargeForPersistedShipment
    ).mockResolvedValue('booked' as never);
    const book = vi.fn();
    const existingShipment = {
      shipmentId: 's-persisted',
      provider: 'GIGL',
      providerShipmentId: 'p-persisted',
      shippingQuoteId: 'q1',
      trackingNumber: 't-persisted',
      carrierName: 'GIGL',
      estimatedDeliveryDays: null,
      labelUrl: null,
      pickupScheduledAt: null,
      status: 'booked',
    };
    const readExisting = vi.fn().mockResolvedValue(existingShipment);

    await expect(
      bookWalletOrCustomerCheckout(
        supabaseFixture,
        'm1',
        'o1',
        'q1',
        'merchant_wallet',
        book,
        undefined,
        undefined,
        readExisting
      )
    ).resolves.toMatchObject({ shipmentId: 's-persisted' });
    expect(book).not.toHaveBeenCalled();
    expect(charge.beginMerchantShippingChargeSubmission).not.toHaveBeenCalled();
    expect(charge.completeMerchantShippingCharge).not.toHaveBeenCalled();
    expect(
      charge.recoverMerchantShippingChargeForPersistedShipment
    ).toHaveBeenCalledWith(
      supabaseFixture,
      'c7',
      'i'.repeat(64),
      's-persisted'
    );
  });
});
