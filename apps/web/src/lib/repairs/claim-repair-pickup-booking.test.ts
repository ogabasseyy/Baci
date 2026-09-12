import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { claimRepairPickupBooking } from './claim-repair-pickup-booking';

describe('claimRepairPickupBooking', () => {
  it('returns failed when the claim RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'claim unavailable' },
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        claimRepairPickupBooking(
          { rpc } as unknown as SupabaseClient,
          'merchant-1',
          'repair-1'
        )
      ).resolves.toEqual({ status: 'failed' });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns the generated lock token when the RPC claims the repair', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ claimed: true, shipment_id: null, terminal: false }],
      error: null,
    });

    const result = await claimRepairPickupBooking(
      { rpc } as unknown as SupabaseClient,
      'merchant-1',
      'repair-1'
    );

    expect(result).toMatchObject({ status: 'claimed' });
    expect(rpc).toHaveBeenCalledWith(
      'claim_repair_pickup_booking',
      expect.objectContaining({ p_lock_timeout_seconds: 900 })
    );
  });

  it('prioritizes a concurrent terminal state over an existing shipment', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ claimed: false, shipment_id: 'shipment-1', terminal: true }],
      error: null,
    });

    const result = await claimRepairPickupBooking(
      { rpc } as unknown as SupabaseClient,
      'merchant-1',
      'repair-1'
    );

    expect(result).toEqual({ status: 'terminal' });
  });

  describe('bugfix: manual_fulfilled during automatic booking race', () => {
    it('maps terminal=true from a manual_fulfilled claim refusal', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: [{ claimed: false, shipment_id: null, terminal: true }],
        error: null,
      });

      const result = await claimRepairPickupBooking(
        { rpc } as unknown as SupabaseClient,
        'merchant-1',
        'repair-1'
      );

      expect(result).toEqual({ status: 'terminal' });
    });
  });
});
