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
  repairRow,
  sampleQuote,
} from './book-repair-pickup.test-support';

const mocks = getRepairPickupMocks();

describe('bookRepairPickup', () => {
  beforeEach(() => {
    arrangeHappyRepairPickup();
  });

  it('books a courier pickup and returns the tracking number', async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const supabase = makeSupabase(happyResponses(), [], inserts);

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toEqual({
      ok: true,
      trackingNumber: 'TRK-123',
      carrierName: 'GIG Logistics',
      shipmentId: 'ship-1',
      pickupScheduledAt: '2026-07-10T00:00:00.000Z',
    });
    expect(mocks.getRepairCenterAddress).toHaveBeenCalledWith(
      merchantId,
      'server-fulfillment'
    );
    expect(mocks.bookShipment).toHaveBeenCalledWith(
      'GIGL',
      expect.objectContaining({
        pickupType: 'pickup',
        quoteMetadata: { cost: 350_000 },
      })
    );
    expect(inserts).toContainEqual({
      table: 'shipments',
      payload: expect.objectContaining({
        order_id: null,
        provider: 'GIGL',
        tracking_number: null,
      }),
    });
  });

  it('bugfix: finalizes GIGL tracking on orderless pickups so monitors can activate', async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const operations: string[] = [];
    const supabase = makeSupabase(happyResponses(), operations, inserts);

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: true, trackingNumber: 'TRK-123' });
    expect(inserts).toContainEqual({
      table: 'shipments',
      payload: expect.objectContaining({
        order_id: null,
        merchant_id: merchantId,
        provider: 'GIGL',
      }),
    });
    expect(operations).toContain('shipments.update');
    expect(operations).toContain('repairs.update');
  });

  it('returns not_found when the repair is missing', async () => {
    const supabase = makeSupabase(
      happyResponses({ 'repairs.select': { data: null, error: null } })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('returns lookup_failed when the repair select errors transiently', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': { data: null, error: { message: 'db timeout' } },
      })
    );

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({ ok: false, reason: 'lookup_failed' });
      expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns already_booked when a shipment is already linked', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: {
            ...repairRow,
            pickup_payment_status: 'booked',
            shipment_id: 'ship-existing',
          },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'already_booked' });
  });

  it('flags a linked pending reservation for review instead of claiming it was booked', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, shipment_id: 'ship-pending' },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({
      ok: false,
      reason: 'shipment_save_failed',
    });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('recovers repair finalization after the provider shipment was saved', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, shipment_id: 'ship-booked' },
          error: null,
        },
        'shipments.select': {
          data: {
            id: 'ship-booked',
            provider_shipment_id: 'provider-1',
            tracking_number: '1349000000',
          },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'already_booked' });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('refuses to book a pickup for a terminal (completed) repair', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, status: 'completed' },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'terminal_status' });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('returns missing_pickup_address when the booking has no pickup address', async () => {
    const supabase = makeSupabase(
      happyResponses({
        'repairs.select': {
          data: { ...repairRow, pickup_address: null },
          error: null,
        },
      })
    );

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({
      ok: false,
      reason: 'missing_pickup_address',
      canRetryManually: true,
    });
  });

  it('returns repair_center_unconfigured when no repair address is set', async () => {
    mocks.getRepairCenterAddress.mockResolvedValueOnce(null);
    const supabase = makeSupabase(happyResponses());

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({
      ok: false,
      reason: 'repair_center_unconfigured',
    });
    expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
  });

  it('returns lookup_failed when repair-center projection query errors', async () => {
    const { RepairCenterLookupError } = await import(
      '@/lib/repairs/repair-center-address'
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getRepairCenterAddress.mockRejectedValueOnce(
      new RepairCenterLookupError('rpc unavailable')
    );
    const supabase = makeSupabase(happyResponses());

    try {
      const result = await bookRepairPickup(supabase, merchantId, repairId);
      expect(result).toMatchObject({ ok: false, reason: 'lookup_failed' });
      expect(mocks.getProviderQuotes).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns gigl_unavailable when no quotes come back', async () => {
    mocks.getProviderQuotes.mockResolvedValueOnce([]);
    const supabase = makeSupabase(happyResponses());

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({
      ok: false,
      reason: 'gigl_unavailable',
      canRetryManually: true,
    });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('does not book when the current GIGL rate exceeds the paid pickup fee', async () => {
    mocks.getProviderQuotes.mockResolvedValueOnce([
      { ...sampleQuote, price: 3600 },
    ]);
    const supabase = makeSupabase(happyResponses());

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({ ok: false, reason: 'quote_increased' });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });

  it('does not book a station-delivery quote for doorstep repair collection', async () => {
    mocks.getProviderQuotes.mockResolvedValueOnce([
      {
        ...sampleQuote,
        id: 'station-q-1',
        isStationPickup: true,
        stationId: 12,
        stationName: 'Osogbo Experience Centre',
      },
    ]);
    const supabase = makeSupabase(happyResponses());

    const result = await bookRepairPickup(supabase, merchantId, repairId);

    expect(result).toMatchObject({
      ok: false,
      reason: 'gigl_unavailable',
      canRetryManually: true,
    });
    expect(mocks.bookShipment).not.toHaveBeenCalled();
  });
});
