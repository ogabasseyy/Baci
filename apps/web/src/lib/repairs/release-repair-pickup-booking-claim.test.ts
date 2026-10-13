import { describe, expect, it, vi } from 'vitest';
import { releaseRepairPickupBookingClaim } from './release-repair-pickup-booking-claim';

describe('releaseRepairPickupBookingClaim', () => {
  it('returns true when the RPC clears the claim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as never;

    await expect(
      releaseRepairPickupBookingClaim(
        supabase,
        'merchant-1',
        'repair-1',
        'lock-1'
      )
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith('release_repair_pickup_booking_claim', {
      p_lock_token: 'lock-1',
      p_merchant_id: 'merchant-1',
      p_repair_id: 'repair-1',
    });
  });
});
