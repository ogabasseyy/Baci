import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { lookupRepairStatus } from './status-lookup';

function makeSupabase(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const row = {
  ticket_number: 1042,
  status: 'in_progress',
  device_type: 'Smartphone',
  device_model: 'iPhone 15',
  repair_type_label: 'Screen Replacement',
  service_type: 'pickup',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-05T00:00:00.000Z',
  tracking_number: 'TRK-1',
  pickup_payment_status: 'booked',
  pickup_fee: 8250,
  pickup_currency: 'NGN',
};

describe('lookupRepairStatus', () => {
  it('maps a matching row into a customer-facing result', async () => {
    const { supabase, rpc } = makeSupabase({ data: [row], error: null });

    const outcome = await lookupRepairStatus(
      supabase,
      'm-1',
      1042,
      'ada@x.com'
    );

    expect(rpc).toHaveBeenCalledWith('get_repair_status', {
      p_merchant_id: 'm-1',
      p_ticket_number: 1042,
      p_email: 'ada@x.com',
    });
    expect(outcome).toEqual({
      found: true,
      result: {
        ticketNumber: 1042,
        status: 'in_progress',
        deviceLabel: 'Smartphone iPhone 15',
        repairTypeLabel: 'Screen Replacement',
        serviceType: 'pickup',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
        trackingNumber: 'TRK-1',
        pickupPaymentStatus: 'booked',
        pickupFee: 8250,
        pickupCurrency: 'NGN',
      },
    });
  });

  it('returns not found when the RPC yields no row (mismatch or missing)', async () => {
    const { supabase } = makeSupabase({ data: [], error: null });
    expect(await lookupRepairStatus(supabase, 'm-1', 9, 'x@y.com')).toEqual({
      found: false,
    });
  });

  it('returns not found (never throws) when the RPC errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = makeSupabase({ data: null, error: { message: 'x' } });
    try {
      expect(await lookupRepairStatus(supabase, 'm-1', 9, 'x@y.com')).toEqual({
        found: false,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns not found when the RPC row is not an object', async () => {
    const { supabase } = makeSupabase({
      data: ['unexpected-scalar'],
      error: null,
    });
    expect(
      await lookupRepairStatus(supabase, 'm-1', 1042, 'ada@x.com')
    ).toEqual({ found: false });
  });

  it('returns not found when the row status is not a valid repair status', async () => {
    const { supabase } = makeSupabase({
      data: [{ ...row, status: 'shipped' }],
      error: null,
    });
    expect(
      await lookupRepairStatus(supabase, 'm-1', 1042, 'ada@x.com')
    ).toEqual({ found: false });
  });

  it('falls back to a generic device label when device fields are empty', async () => {
    const { supabase } = makeSupabase({
      data: [{ ...row, device_type: null, device_model: null }],
      error: null,
    });
    const outcome = await lookupRepairStatus(
      supabase,
      'm-1',
      1042,
      'ada@x.com'
    );
    expect(outcome).toMatchObject({ found: true });
    if (outcome.found) {
      expect(outcome.result.deviceLabel).toBe('Device');
    }
  });

  it('omits a non-numeric pickup fee from the public result', async () => {
    const { supabase } = makeSupabase({
      data: [{ ...row, pickup_fee: 'not-a-number' }],
      error: null,
    });

    const outcome = await lookupRepairStatus(
      supabase,
      'm-1',
      1042,
      'ada@x.com'
    );

    expect(outcome).toMatchObject({
      found: true,
      result: { pickupFee: null },
    });
  });
});
