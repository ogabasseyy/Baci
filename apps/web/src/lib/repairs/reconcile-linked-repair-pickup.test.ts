import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { reconcileLinkedRepairPickup } from './reconcile-linked-repair-pickup';

function createSupabase(shipment: Record<string, unknown> | null) {
  const repairResult = { error: null };
  const shipmentChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: shipment, error: null }),
  };
  const repairChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(repairResult).then(resolve),
  };
  const from = vi.fn((table: string) =>
    table === 'shipments' ? shipmentChain : repairChain
  );
  return {
    client: { from } as unknown as SupabaseClient,
    repairChain,
  };
}

describe('reconcileLinkedRepairPickup', () => {
  it('finalizes a repair after the provider shipment was already saved', async () => {
    const { client, repairChain } = createSupabase({
      id: 'ship-1',
      provider_shipment_id: 'provider-1',
      tracking_number: '1349000000',
    });

    await expect(
      reconcileLinkedRepairPickup(client, 'm-1', 'r-1', 'ship-1')
    ).resolves.toBe(true);
    expect(repairChain.update).toHaveBeenCalledWith({
      pickup_booking_lock_token: null,
      pickup_booking_started_at: null,
      pickup_payment_status: 'booked',
    });
  });

  it('does not mark an unresolved local reservation as booked', async () => {
    const { client, repairChain } = createSupabase({
      id: 'ship-1',
      provider_shipment_id: null,
      tracking_number: null,
    });

    await expect(
      reconcileLinkedRepairPickup(client, 'm-1', 'r-1', 'ship-1')
    ).resolves.toBe(false);
    expect(repairChain.update).not.toHaveBeenCalled();
  });
});
