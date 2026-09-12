import { describe, expect, it, vi } from 'vitest';
import type { TrackingResult } from '@/lib/shipping/types';

import {
  claimedGiglTrackingMonitorsSchema,
  processClaimedGiglTrackingMonitors,
} from './gigl-tracking-monitor-worker';

const monitor = {
  order_id: '00000000-0000-4000-8000-000000000001',
  shipment_id: '00000000-0000-4000-8000-000000000002',
  state: 'active' as const,
  tracking_epoch_id: '00000000-0000-4000-8000-000000000003',
  tracking_number: 'GIGL-1',
};

const result: TrackingResult = {
  carrierName: 'GIG Logistics',
  events: [
    {
      description: 'In transit',
      providerEventKey: 'event-1',
      rawStatus: 'In transit',
      status: 'in_transit',
      timestamp: new Date('2026-07-31T10:00:00.000Z'),
    },
  ],
  provider: 'GIGL',
  status: 'in_transit',
  trackingNumber: 'GIGL-1',
};

const unrecognizedResult: TrackingResult = {
  ...result,
  events: [
    {
      description: 'Provider scan',
      providerEventKey: 'event-unknown',
      rawStatus: 'UNPUBLISHED_CODE',
      status: 'pending',
      timestamp: new Date('2026-07-31T10:00:00.000Z'),
    },
  ],
  hasRecognizedLifecycleEvent: false,
  status: 'pending',
};

function createSupabase() {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { rpc };
}

describe('processClaimedGiglTrackingMonitors', () => {
  it('applies every returned tracking result through the epoch-safe RPC', async () => {
    const supabase = createSupabase();
    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', result]])
    );

    expect(summary).toEqual({
      applied: 1,
      claimed: 1,
      failed: 0,
      paused: 0,
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'apply_gigl_tracking_result',
      expect.objectContaining({
        p_shipment_id: monitor.shipment_id,
        p_tracking_epoch_id: monitor.tracking_epoch_id,
        p_worker_id: 'worker-1',
      })
    );
  });

  it('accepts paused monitor claims while they are in cooldown', () => {
    expect(
      claimedGiglTrackingMonitorsSchema.parse([{ ...monitor, state: 'paused' }])
    ).toEqual([{ ...monitor, state: 'paused' }]);
  });

  it('bugfix: processes orderless repair-pickup monitor claims without dropping them', async () => {
    const orderless = { ...monitor, order_id: null };
    expect(claimedGiglTrackingMonitorsSchema.parse([orderless])).toEqual([
      orderless,
    ]);

    const supabase = createSupabase();
    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [orderless],
      'worker-1',
      async () => new Map([['GIGL-1', result]])
    );

    expect(summary).toEqual({
      applied: 1,
      claimed: 1,
      failed: 0,
      paused: 0,
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'apply_gigl_tracking_result',
      expect.objectContaining({
        p_shipment_id: orderless.shipment_id,
        p_tracking_epoch_id: orderless.tracking_epoch_id,
      })
    );
  });

  it('records a failure when the batch response omits a claimed waybill', async () => {
    const supabase = createSupabase();
    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map()
    );

    expect(summary).toEqual({
      applied: 0,
      claimed: 1,
      failed: 1,
      paused: 0,
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_gigl_tracking_failure',
      expect.objectContaining({
        p_error: 'GIGL batch tracking omitted claimed waybill',
      })
    );
  });

  it('releases the claim when a stale worker cannot apply a result', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValueOnce({ data: false, error: null });

    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', result]])
    );

    expect(summary).toEqual({
      applied: 0,
      claimed: 1,
      failed: 0,
      paused: 0,
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'release_gigl_tracking_claim',
      expect.objectContaining({ p_shipment_id: monitor.shipment_id })
    );
  });

  it('pauses a monitor when GIGL returns no recognized lifecycle event', async () => {
    const supabase = createSupabase();
    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', unrecognizedResult]])
    );

    expect(summary).toEqual({
      applied: 0,
      claimed: 1,
      failed: 0,
      paused: 1,
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'pause_gigl_tracking_monitor',
      expect.objectContaining({
        p_error: 'GIGL tracking result has no recognized lifecycle event',
        p_shipment_id: monitor.shipment_id,
        p_tracking_epoch_id: monitor.tracking_epoch_id,
        p_worker_id: 'worker-1',
      })
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'record_gigl_tracking_failure',
      expect.anything()
    );
  });

  it('records a failure when it loses the claim before pausing an unknown result', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValueOnce({ data: false, error: null });

    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', unrecognizedResult]])
    );

    expect(summary).toEqual({
      applied: 0,
      claimed: 1,
      failed: 1,
      paused: 0,
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'release_gigl_tracking_claim',
      expect.objectContaining({ p_shipment_id: monitor.shipment_id })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_gigl_tracking_failure',
      expect.objectContaining({
        p_error: 'GIGL tracking result has no recognized lifecycle event',
      })
    );
  });

  it('backs off all claimed monitors when the provider request fails', async () => {
    const supabase = createSupabase();
    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => {
        throw new Error('GIGL unavailable');
      }
    );

    expect(summary).toEqual({
      applied: 0,
      claimed: 1,
      failed: 1,
      paused: 0,
      success: true,
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_gigl_tracking_failure',
      expect.objectContaining({ p_error: 'GIGL unavailable' })
    );
  });
});
