import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('bookRepairPickup pre-provider reservation failures', () => {
  beforeEach(arrangeHappyRepairPickup);

  it('releases the booking claim when local shipment persistence fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    const supabase = makeSupabase(
      happyResponses({
        'shipments.insert': {
          data: null,
          error: { message: 'insert failed' },
        },
      }),
      operations
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({
        ok: false,
        reason: 'booking_failed',
      });
      expect(operations).toContain('rpc.release_repair_pickup_booking_claim');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns booking_in_progress without booking when another request owns the claim', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'rpc.claim_repair_pickup_booking': {
          data: [{ claimed: false, shipment_id: null }],
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({
      ok: false,
      reason: 'booking_in_progress',
      canRetryManually: false,
    });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('returns already_booked without booking when the claim sees a shipment', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'rpc.claim_repair_pickup_booking': {
          data: [{ claimed: false, shipment_id: 'ship-existing' }],
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({
      ok: false,
      reason: 'already_booked',
      canRetryManually: false,
    });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('fails closed when the repair goes terminal during the claim', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'rpc.claim_repair_pickup_booking': {
          data: [{ claimed: false, shipment_id: null, terminal: true }],
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'terminal_status' });
    expect(mocks.getProviderQuotes).toHaveBeenCalled();
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('does not book when the quote cannot be persisted', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase(
      happyResponses({
        'repair_pickup_quotes.insert': {
          data: null,
          error: { message: 'insert boom' },
        },
      })
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({ ok: false, reason: 'booking_failed' });
      expect(mocks.bookShipment).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('fails when linking the shipment to the repair errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    const supabase = makeSupabase(
      happyResponses({
        'repairs.update': { data: null, error: { message: 'link boom' } },
      }),
      operations
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({
        ok: false,
        reason: 'booking_failed',
        canRetryManually: true,
      });
      expect(operations).toContain('shipments.delete');
      expect(operations).toContain('rpc.release_repair_pickup_booking_claim');
      expect(mocks.bookShipment).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('fails when the claimed booking cannot be linked', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    const supabase = makeSupabase(
      happyResponses({ 'repairs.update': { data: [], error: null } }),
      operations
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({
        ok: false,
        reason: 'booking_failed',
        canRetryManually: true,
      });
      expect(operations).toContain('shipments.delete');
      expect(operations).toContain('rpc.release_repair_pickup_booking_claim');
      expect(mocks.bookShipment).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('retains the booking claim when orphan shipment cleanup fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operations: string[] = [];
    const supabase = makeSupabase(
      happyResponses({
        'repairs.update': { data: [], error: null },
        'shipments.delete': { data: null, error: { message: 'delete boom' } },
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
      expect(operations).toContain('shipments.delete');
      expect(operations).not.toContain(
        'rpc.release_repair_pickup_booking_claim'
      );
      expect(mocks.bookShipment).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns a retryable booking_failed when the shipment row cannot be saved before GIGL booking', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase(
      happyResponses({
        'shipments.insert': { data: null, error: { message: 'boom' } },
      })
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({
        ok: false,
        reason: 'booking_failed',
        canRetryManually: true,
      });
      expect(mocks.bookShipment).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
