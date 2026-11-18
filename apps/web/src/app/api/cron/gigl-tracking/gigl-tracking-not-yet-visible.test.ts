import { describe, expect, it, vi } from 'vitest';
import {
  type QuietPollSupabaseClient,
  recordNotYetVisible,
} from './gigl-tracking-not-yet-visible';
import { GIGL_WAYBILL_NOT_YET_VISIBLE } from './gigl-tracking-not-yet-visible.constants';

const monitor = {
  shipment_id: '00000000-0000-4000-8000-000000000002',
  tracking_epoch_id: '00000000-0000-4000-8000-000000000003',
};

describe('recordNotYetVisible', () => {
  it('writes the quiet-poll marker via record_gigl_tracking_failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase: QuietPollSupabaseClient = { rpc };

    await expect(
      recordNotYetVisible(supabase, monitor, 'worker-1')
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('record_gigl_tracking_failure', {
      p_error: GIGL_WAYBILL_NOT_YET_VISIBLE,
      p_shipment_id: monitor.shipment_id,
      p_tracking_epoch_id: monitor.tracking_epoch_id,
      p_worker_id: 'worker-1',
    });
  });

  it('throws when the RPC returns an error', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'db down' } });
    const supabase: QuietPollSupabaseClient = { rpc };

    await expect(
      recordNotYetVisible(supabase, monitor, 'worker-1')
    ).rejects.toThrow('Failed to record GIGL waybill as not yet visible');
  });
});
