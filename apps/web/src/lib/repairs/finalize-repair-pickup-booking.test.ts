import { describe, expect, it, vi } from 'vitest';
import { finalizeRepairPickupBooking } from './finalize-repair-pickup-booking';

describe('finalizeRepairPickupBooking', () => {
  it('returns shipment_save_failed when the booked shipment cannot be updated', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'write failed' },
    });
    const eqMerchant = vi.fn().mockReturnValue({ select: () => ({ single }) });
    const eqId = vi.fn().mockReturnValue({ eq: eqMerchant });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    const from = vi.fn().mockReturnValue({ update });

    const result = await finalizeRepairPickupBooking({
      booking: {
        carrierName: 'GIG Logistics',
        isStationPickup: false,
        provider: 'GIGL',
        providerShipmentId: 'prov-1',
        status: 'pending',
        trackingNumber: '1349000000',
      },
      lockToken: 'lock-1',
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      quoteId: 'quote-1',
      repairId: '223e4567-e89b-12d3-a456-426614174000',
      shipmentId: 'shipment-1',
      supabase: { from } as never,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'shipment_save_failed',
    });
    expect(from).toHaveBeenCalledWith('shipments');
  });

  it('marks the repair booked and clears the lock after a successful shipment update', async () => {
    const shipmentSingle = vi.fn().mockResolvedValue({
      data: { id: 'shipment-1' },
      error: null,
    });
    const shipmentEqMerchant = vi
      .fn()
      .mockReturnValue({ select: () => ({ single: shipmentSingle }) });
    const shipmentEqId = vi.fn().mockReturnValue({ eq: shipmentEqMerchant });
    const shipmentUpdate = vi.fn().mockReturnValue({ eq: shipmentEqId });

    const repairEqLock = vi.fn().mockResolvedValue({ error: null });
    const repairEqShipment = vi.fn().mockReturnValue({ eq: repairEqLock });
    const repairEqMerchant = vi.fn().mockReturnValue({ eq: repairEqShipment });
    const repairEqId = vi.fn().mockReturnValue({ eq: repairEqMerchant });
    const repairUpdate = vi.fn().mockReturnValue({ eq: repairEqId });

    const quoteEqMerchant = vi.fn().mockResolvedValue({ error: null });
    const quoteEqId = vi.fn().mockReturnValue({ eq: quoteEqMerchant });
    const quoteUpdate = vi.fn().mockReturnValue({ eq: quoteEqId });

    const from = vi.fn((table: string) => {
      if (table === 'shipments') {
        return { update: shipmentUpdate };
      }
      if (table === 'repairs') {
        return { update: repairUpdate };
      }
      return { update: quoteUpdate };
    });

    const result = await finalizeRepairPickupBooking({
      booking: {
        carrierName: 'GIG Logistics',
        isStationPickup: false,
        provider: 'GIGL',
        providerShipmentId: 'prov-1',
        status: 'pending',
        trackingNumber: '1349000000',
      },
      lockToken: 'lock-1',
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      quoteId: 'quote-1',
      repairId: '223e4567-e89b-12d3-a456-426614174000',
      shipmentId: 'shipment-1',
      supabase: { from } as never,
    });

    expect(result).toMatchObject({
      ok: true,
      trackingNumber: '1349000000',
      shipmentId: 'shipment-1',
    });
    expect(repairUpdate).toHaveBeenCalledWith({
      pickup_booking_lock_token: null,
      pickup_booking_started_at: null,
      pickup_payment_status: 'booked',
    });
    expect(quoteUpdate).toHaveBeenCalledWith({ used: true });
  });

  it('bugfix: writes GIGL tracking onto an orderless pickup shipment for monitor enrollment', async () => {
    const shipmentSingle = vi.fn().mockResolvedValue({
      data: { id: 'shipment-1' },
      error: null,
    });
    const shipmentEqMerchant = vi
      .fn()
      .mockReturnValue({ select: () => ({ single: shipmentSingle }) });
    const shipmentEqId = vi.fn().mockReturnValue({ eq: shipmentEqMerchant });
    const shipmentUpdate = vi.fn().mockReturnValue({ eq: shipmentEqId });

    const repairEqLock = vi.fn().mockResolvedValue({ error: null });
    const repairEqShipment = vi.fn().mockReturnValue({ eq: repairEqLock });
    const repairEqMerchant = vi.fn().mockReturnValue({ eq: repairEqShipment });
    const repairEqId = vi.fn().mockReturnValue({ eq: repairEqMerchant });
    const repairUpdate = vi.fn().mockReturnValue({ eq: repairEqId });

    const quoteEqMerchant = vi.fn().mockResolvedValue({ error: null });
    const quoteEqId = vi.fn().mockReturnValue({ eq: quoteEqMerchant });
    const quoteUpdate = vi.fn().mockReturnValue({ eq: quoteEqId });

    const from = vi.fn((table: string) => {
      if (table === 'shipments') {
        return { update: shipmentUpdate };
      }
      if (table === 'repairs') {
        return { update: repairUpdate };
      }
      return { update: quoteUpdate };
    });

    const result = await finalizeRepairPickupBooking({
      booking: {
        carrierName: 'GIG Logistics',
        isStationPickup: false,
        provider: 'GIGL',
        providerShipmentId: 'prov-1',
        status: 'pending',
        trackingNumber: '1349000000',
      },
      lockToken: 'lock-1',
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      quoteId: 'quote-1',
      repairId: '223e4567-e89b-12d3-a456-426614174000',
      shipmentId: 'shipment-1',
      supabase: { from } as never,
    });

    expect(result).toMatchObject({ ok: true, trackingNumber: '1349000000' });
    // Finalize writes tracking_number on the already-linked null-order_id
    // shipment; activate_gigl_tracking_monitor enrolls repair-linked rows.
    expect(shipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'GIGL',
        tracking_number: '1349000000',
      })
    );
  });

  describe('bugfix: booked-state persistence must fail closed for webhook retry', () => {
    it('returns shipment_save_failed when clearing the booking lock fails after GIGL succeeds', async () => {
      const shipmentSingle = vi.fn().mockResolvedValue({
        data: { id: 'shipment-1' },
        error: null,
      });
      const shipmentEqMerchant = vi
        .fn()
        .mockReturnValue({ select: () => ({ single: shipmentSingle }) });
      const shipmentEqId = vi.fn().mockReturnValue({ eq: shipmentEqMerchant });
      const shipmentUpdate = vi.fn().mockReturnValue({ eq: shipmentEqId });

      const repairEqLock = vi
        .fn()
        .mockResolvedValue({ error: { message: 'lock clear failed' } });
      const repairEqShipment = vi.fn().mockReturnValue({ eq: repairEqLock });
      const repairEqMerchant = vi
        .fn()
        .mockReturnValue({ eq: repairEqShipment });
      const repairEqId = vi.fn().mockReturnValue({ eq: repairEqMerchant });
      const repairUpdate = vi.fn().mockReturnValue({ eq: repairEqId });

      const from = vi.fn((table: string) => {
        if (table === 'shipments') {
          return { update: shipmentUpdate };
        }
        return { update: repairUpdate };
      });

      const result = await finalizeRepairPickupBooking({
        booking: {
          carrierName: 'GIG Logistics',
          isStationPickup: false,
          provider: 'GIGL',
          providerShipmentId: 'prov-1',
          status: 'pending',
          trackingNumber: '1349000000',
        },
        lockToken: 'lock-1',
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        quoteId: 'quote-1',
        repairId: '223e4567-e89b-12d3-a456-426614174000',
        shipmentId: 'shipment-1',
        supabase: { from } as never,
      });

      expect(result).toMatchObject({
        ok: false,
        reason: 'shipment_save_failed',
      });
    });

    it('returns shipment_save_failed when marking the quote used fails after the lock clears', async () => {
      const shipmentSingle = vi.fn().mockResolvedValue({
        data: { id: 'shipment-1' },
        error: null,
      });
      const shipmentEqMerchant = vi
        .fn()
        .mockReturnValue({ select: () => ({ single: shipmentSingle }) });
      const shipmentEqId = vi.fn().mockReturnValue({ eq: shipmentEqMerchant });
      const shipmentUpdate = vi.fn().mockReturnValue({ eq: shipmentEqId });

      const repairEqLock = vi.fn().mockResolvedValue({ error: null });
      const repairEqShipment = vi.fn().mockReturnValue({ eq: repairEqLock });
      const repairEqMerchant = vi
        .fn()
        .mockReturnValue({ eq: repairEqShipment });
      const repairEqId = vi.fn().mockReturnValue({ eq: repairEqMerchant });
      const repairUpdate = vi.fn().mockReturnValue({ eq: repairEqId });

      const quoteEqMerchant = vi
        .fn()
        .mockResolvedValue({ error: { message: 'quote update failed' } });
      const quoteEqId = vi.fn().mockReturnValue({ eq: quoteEqMerchant });
      const quoteUpdate = vi.fn().mockReturnValue({ eq: quoteEqId });

      const from = vi.fn((table: string) => {
        if (table === 'shipments') {
          return { update: shipmentUpdate };
        }
        if (table === 'repairs') {
          return { update: repairUpdate };
        }
        return { update: quoteUpdate };
      });

      const result = await finalizeRepairPickupBooking({
        booking: {
          carrierName: 'GIG Logistics',
          isStationPickup: false,
          provider: 'GIGL',
          providerShipmentId: 'prov-1',
          status: 'pending',
          trackingNumber: '1349000000',
        },
        lockToken: 'lock-1',
        merchantId: '123e4567-e89b-12d3-a456-426614174000',
        quoteId: 'quote-1',
        repairId: '223e4567-e89b-12d3-a456-426614174000',
        shipmentId: 'shipment-1',
        supabase: { from } as never,
      });

      expect(result).toMatchObject({
        ok: false,
        reason: 'shipment_save_failed',
      });
    });
  });
});
