import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { runGiglTrackingMonitorBatch } from './run-gigl-tracking-monitor-batch';

function clientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe('runGiglTrackingMonitorBatch', () => {
  it('claims the bounded batch and processes it with the shared worker', async () => {
    const monitor = {
      order_id: '00000000-0000-4000-8000-000000000001',
      shipment_id: '00000000-0000-4000-8000-000000000002',
      state: 'active',
      tracking_epoch_id: '00000000-0000-4000-8000-000000000003',
      tracking_number: 'GIGL-123',
    };
    const rpc = vi.fn().mockResolvedValue({ data: [monitor], error: null });
    const client = clientWithRpc(rpc);
    const processMonitors = vi.fn().mockResolvedValue({
      applied: 0,
      claimed: 1,
      failed: 0,
      paused: 0,
      success: true,
    });

    const result = await runGiglTrackingMonitorBatch({
      batchSize: 25,
      client,
      processMonitors,
      workerId: 'gigl-worker-1',
    });

    expect(rpc).toHaveBeenCalledWith('claim_due_gigl_tracking_monitors', {
      p_limit: 25,
      p_worker_id: 'gigl-worker-1',
    });
    expect(processMonitors).toHaveBeenCalledWith(
      client,
      [monitor],
      'gigl-worker-1'
    );
    expect(result).toEqual({
      ok: true,
      summary: {
        applied: 0,
        claimed: 1,
        failed: 0,
        paused: 0,
        success: true,
      },
    });
  });

  it('returns a bounded failure when the claim fails', async () => {
    const result = await runGiglTrackingMonitorBatch({
      batchSize: 25,
      client: clientWithRpc(
        vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'database internals' },
        })
      ),
      processMonitors: vi.fn(),
      workerId: 'gigl-worker-2',
    });

    expect(result).toEqual({ ok: false, reason: 'claim_failed' });
  });

  it('does not process a malformed claim payload', async () => {
    const processMonitors = vi.fn();

    const result = await runGiglTrackingMonitorBatch({
      batchSize: 25,
      client: clientWithRpc(
        vi.fn().mockResolvedValue({ data: [{ id: 'invalid' }], error: null })
      ),
      processMonitors,
      workerId: 'gigl-worker-3',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_claim_payload' });
    expect(processMonitors).not.toHaveBeenCalled();
  });

  it('returns a bounded failure when monitor processing throws', async () => {
    const result = await runGiglTrackingMonitorBatch({
      batchSize: 25,
      client: clientWithRpc(
        vi.fn().mockResolvedValue({ data: [], error: null })
      ),
      processMonitors: vi.fn().mockRejectedValue(new Error('provider detail')),
      workerId: 'gigl-worker-4',
    });

    expect(result).toEqual({ ok: false, reason: 'worker_failed' });
  });
});
