import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fulfillRepairPickupAfterPayment } from './fulfill-repair-pickup-after-payment';

const mocks = vi.hoisted(() => ({
  bookRepairPickup: vi.fn(),
  notifyRepairPickupBookingAfterPayment: vi.fn(),
}));

vi.mock('@/lib/repairs/book-repair-pickup', () => ({
  bookRepairPickup: mocks.bookRepairPickup,
}));

vi.mock('@/lib/repairs/notify-repair-pickup-booking', () => ({
  notifyRepairPickupBookingAfterPayment:
    mocks.notifyRepairPickupBookingAfterPayment,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const repairId = '223e4567-e89b-12d3-a456-426614174000';
const reference = 'RPU-ABC123DEF45678';

describe('fulfillRepairPickupAfterPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyRepairPickupBookingAfterPayment.mockResolvedValue(undefined);
  });

  it('books and notifies when GIGL booking succeeds', async () => {
    mocks.bookRepairPickup.mockResolvedValue({
      ok: true,
      carrierName: 'GIG Logistics',
      pickupScheduledAt: null,
      shipmentId: 'shipment-1',
      trackingNumber: '1349000000',
    });

    const result = await fulfillRepairPickupAfterPayment({
      merchantId,
      pickupPaymentStatus: 'retrying',
      reference,
      repairId,
      supabase: { from: vi.fn() } as never,
    });

    expect(result).toEqual({
      handled: true,
      status: 200,
      body: {
        message: 'Repair pickup payment confirmed and shipment booked',
        trackingNumber: '1349000000',
      },
    });
    expect(mocks.bookRepairPickup).toHaveBeenCalledWith(
      expect.anything(),
      merchantId,
      repairId
    );
    expect(mocks.notifyRepairPickupBookingAfterPayment).toHaveBeenCalled();
  });

  it('returns without booking when status is already manual_fulfilled', async () => {
    const result = await fulfillRepairPickupAfterPayment({
      merchantId,
      pickupPaymentStatus: 'manual_fulfilled',
      reference,
      repairId,
      supabase: { from: vi.fn() } as never,
    });

    expect(result.status).toBe(200);
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });
});
