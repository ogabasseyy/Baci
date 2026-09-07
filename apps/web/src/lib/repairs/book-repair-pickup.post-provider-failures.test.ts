import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import './book-repair-pickup.test-support';
import { bookRepairPickup } from './book-repair-pickup';
import {
  arrangeHappyRepairPickup,
  getRepairPickupMocks,
  happyResponses,
  makeSupabase,
  merchantId,
  repairId,
} from './book-repair-pickup.test-support';

const mocks = getRepairPickupMocks();

describe('bookRepairPickup post-provider finalization failures', () => {
  beforeEach(arrangeHappyRepairPickup);

  it('keeps the reservation locked when GIGL booking cannot be confirmed', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    mocks.bookShipment.mockRejectedValueOnce(new Error('wallet empty'));
    const supabase = makeSupabase(happyResponses(), operations);

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({
        ok: false,
        reason: 'shipment_save_failed',
        canRetryManually: false,
      });
      expect(operations).not.toContain(
        'rpc.release_rejected_repair_pickup_reservation'
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('releases the reservation after a pre-capture GIGL authentication failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    mocks.bookShipment.mockRejectedValueOnce(
      new OrderShipmentBookingError(
        'GIGL API authentication failed',
        502,
        'GIGL_AUTHENTICATION_FAILED'
      )
    );
    const supabase = makeSupabase(happyResponses(), operations);

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({
        ok: false,
        reason: 'booking_failed',
        canRetryManually: true,
      });
      expect(operations).toContain(
        'rpc.release_rejected_repair_pickup_reservation'
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('releases the reservation after a confirmed GIGL booking rejection', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    mocks.bookShipment.mockRejectedValueOnce(
      new OrderShipmentBookingError(
        'GIGL rejected the shipment booking request.',
        400,
        'GIGL_BOOKING_VALIDATION_FAILED'
      )
    );
    const supabase = makeSupabase(happyResponses(), operations);

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({
        ok: false,
        reason: 'provider_rejected',
        canRetryManually: true,
      });
      expect(
        operations.filter((operation) => operation === 'repairs.update')
      ).toHaveLength(1);
      expect(operations).toContain(
        'rpc.release_rejected_repair_pickup_reservation'
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('preserves the reservation when atomic rejected-booking release fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    mocks.bookShipment.mockRejectedValueOnce(
      new OrderShipmentBookingError(
        'GIGL rejected the shipment booking request.',
        400,
        'GIGL_BOOKING_VALIDATION_FAILED'
      )
    );
    const supabase = makeSupabase(
      happyResponses({
        'rpc.release_rejected_repair_pickup_reservation': {
          data: null,
          error: { message: 'atomic release failed' },
        },
      }),
      operations
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);

      expect(result).toMatchObject({
        ok: false,
        reason: 'shipment_save_failed',
        canRetryManually: false,
      });
      expect(operations).toContain(
        'rpc.release_rejected_repair_pickup_reservation'
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('preserves the reservation when finalizing a paid shipment fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase(
      happyResponses({
        'shipments.update': { data: null, error: { message: 'finalize boom' } },
      })
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);

      expect(result).toMatchObject({
        ok: false,
        reason: 'shipment_save_failed',
        canRetryManually: false,
      });
      expect(mocks.bookShipment).toHaveBeenCalledTimes(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
