import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { releaseRejectedRepairPickupReservation } from './release-rejected-repair-pickup-reservation';

describe('releaseRejectedRepairPickupReservation', () => {
  it('releases the local reservation through the atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      releaseRejectedRepairPickupReservation(
        { rpc } as unknown as SupabaseClient,
        'merchant-1',
        'repair-1',
        'shipment-1',
        'lock-1'
      )
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'release_rejected_repair_pickup_reservation',
      {
        p_lock_token: 'lock-1',
        p_merchant_id: 'merchant-1',
        p_repair_id: 'repair-1',
        p_shipment_id: 'shipment-1',
      }
    );
  });

  it('preserves the reservation when the atomic release fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'shipment delete failed' },
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        releaseRejectedRepairPickupReservation(
          { rpc } as unknown as SupabaseClient,
          'merchant-1',
          'repair-1',
          'shipment-1',
          'lock-1'
        )
      ).resolves.toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('fails closed when the reservation no longer matches the claim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        releaseRejectedRepairPickupReservation(
          { rpc } as unknown as SupabaseClient,
          'merchant-1',
          'repair-1',
          'shipment-1',
          'lock-1'
        )
      ).resolves.toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
