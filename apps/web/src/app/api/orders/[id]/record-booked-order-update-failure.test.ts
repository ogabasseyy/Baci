import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { recordBookedOrderUpdateFailure } from './record-booked-order-update-failure';

describe('recordBookedOrderUpdateFailure', () => {
  it('records a booked_not_saved row with the lock retained', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn(() => ({ insert })),
    } as unknown as SupabaseClient;

    await recordBookedOrderUpdateFailure(supabase, 'merchant-1', 'order-1');

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: 'merchant-1',
        order_id: 'order-1',
        error_code: 'BOOKED_SHIPMENT_NOT_SAVED',
        outcome: 'booked_not_saved',
        lock_retained: true,
      })
    );
  });

  it('never throws when recording fails', async () => {
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn().mockRejectedValue(new Error('db down')),
      })),
    } as unknown as SupabaseClient;

    await expect(
      recordBookedOrderUpdateFailure(supabase, 'merchant-1', 'order-1')
    ).resolves.toBeUndefined();
  });
});
