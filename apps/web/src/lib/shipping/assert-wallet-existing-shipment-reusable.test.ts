import { describe, expect, it, vi } from 'vitest';
import {
  assertWalletExistingShipmentReusable,
  assertWalletExistingShipmentReusableOrRelease,
} from './assert-wallet-existing-shipment-reusable';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

const existingShipment = {
  shipmentId: 's-existing',
  provider: 'GIGL' as const,
  providerShipmentId: 'p-existing',
  trackingNumber: 't-existing',
  carrierName: 'GIGL',
  quoteId: 'q-existing',
  estimatedDays: null,
  shipmentStatus: 'booked' as const,
};

describe('assertWalletExistingShipmentReusable', () => {
  it('allows an existing GIGL shipment that matches the requested quote', () => {
    expect(() =>
      assertWalletExistingShipmentReusable(existingShipment, 'q-existing')
    ).not.toThrow();
  });

  it('rejects an existing shipment from a different provider', () => {
    expect(() =>
      assertWalletExistingShipmentReusable(
        { ...existingShipment, provider: 'TOPSHIP' },
        'q-existing'
      )
    ).toThrow(
      expect.objectContaining({ code: 'EXISTING_SHIPMENT_PROVIDER_MISMATCH' })
    );
  });

  it('rejects an existing shipment booked with a different quote', () => {
    expect(() =>
      assertWalletExistingShipmentReusable(existingShipment, 'q-new')
    ).toThrow(OrderShipmentBookingError);

    try {
      assertWalletExistingShipmentReusable(existingShipment, 'q-new');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'EXISTING_SHIPMENT_QUOTE_MISMATCH',
        status: 409,
      });
    }
  });

  it('releases the booking lock when a mismatched shipment is rejected', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    await expect(
      assertWalletExistingShipmentReusableOrRelease(
        { ...existingShipment, provider: 'TOPSHIP' },
        'q-existing',
        release
      )
    ).rejects.toMatchObject({ code: 'EXISTING_SHIPMENT_PROVIDER_MISMATCH' });
    expect(release).toHaveBeenCalledOnce();
  });
});
