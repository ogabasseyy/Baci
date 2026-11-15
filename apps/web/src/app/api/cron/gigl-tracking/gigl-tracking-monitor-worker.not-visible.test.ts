import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, info: vi.fn(), warn: vi.fn() },
}));

import {
  GIGL_WAYBILL_NOT_YET_VISIBLE,
  processClaimedGiglTrackingMonitors,
} from './gigl-tracking-monitor-worker';

const monitor = {
  order_id: '00000000-0000-4000-8000-000000000001',
  shipment_id: '00000000-0000-4000-8000-000000000002',
  state: 'active' as const,
  tracking_epoch_id: '00000000-0000-4000-8000-000000000003',
  tracking_number: '1349644465',
};

describe('GIG waybill not yet visible in batch tracking', () => {
  beforeEach(() => loggerError.mockClear());

  it('records a quiet poll, not a failure, when GIG omits a booked waybill', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    const summary = await processClaimedGiglTrackingMonitors(
      { rpc } as never,
      [monitor],
      'worker-1',
      async () => new Map(),
      async () => 'unavailable',
      async () => 'unknown'
    );

    expect(summary).toEqual({
      applied: 0,
      claimed: 1,
      failed: 0,
      paused: 0,
      success: true,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_gigl_tracking_failure', {
      p_error: GIGL_WAYBILL_NOT_YET_VISIBLE,
      p_shipment_id: monitor.shipment_id,
      p_tracking_epoch_id: monitor.tracking_epoch_id,
      p_worker_id: 'worker-1',
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('still counts a failed quiet-poll write as a failure', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
      .mockResolvedValue({ data: true, error: null });

    const summary = await processClaimedGiglTrackingMonitors(
      { rpc } as never,
      [monitor],
      'worker-1',
      async () => new Map(),
      async () => 'unavailable',
      async () => 'unknown'
    );

    expect(summary.failed).toBe(1);
    expect(loggerError).toHaveBeenCalledTimes(1);
  });
});
