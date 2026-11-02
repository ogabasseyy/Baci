import { describe, expect, it, vi } from 'vitest';
import type { TrackingResult } from '@/lib/shipping/types';

import { processClaimedGiglTrackingMonitors } from './gigl-tracking-monitor-worker';

const monitor = {
  order_id: '00000000-0000-4000-8000-000000000001',
  shipment_id: '00000000-0000-4000-8000-000000000002',
  state: 'active' as const,
  tracking_epoch_id: '00000000-0000-4000-8000-000000000003',
  tracking_number: 'GIGL-1',
};

const cancelledResult: TrackingResult = {
  carrierName: 'GIG Logistics',
  events: [
    {
      description: 'Shipment cancelled by GIG',
      providerEventKey: 'MSCC:1',
      rawStatus: 'MSCC',
      status: 'cancelled',
      timestamp: new Date('2026-11-02T05:40:00.000Z'),
    },
    {
      description: 'Shipment created',
      providerEventKey: 'MCRT:1',
      rawStatus: 'MCRT',
      status: 'booked',
      timestamp: new Date('2026-11-02T05:33:03.500Z'),
    },
  ],
  provider: 'GIGL',
  status: 'cancelled',
  trackingNumber: 'GIGL-1',
};

const inTransitResult: TrackingResult = {
  ...cancelledResult,
  events: [
    {
      description: 'In transit',
      providerEventKey: 'MAPT:1',
      rawStatus: 'MAPT',
      status: 'in_transit',
      timestamp: new Date('2026-11-02T06:00:00.000Z'),
    },
  ],
  status: 'in_transit',
};

type SerializedEvent = Record<string, unknown>;

function createSupabase() {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { rpc };
}

function appliedEvents(rpc: ReturnType<typeof createSupabase>['rpc']) {
  const call = rpc.mock.calls.find(
    ([name]) => name === 'apply_gigl_tracking_result'
  );
  if (!call) throw new Error('apply_gigl_tracking_result was not called');
  return (call[1] as { p_events: SerializedEvent[] }).p_events;
}

describe('bugfix: GIG cancellation refunds need Baci-account attestation', () => {
  it('marks only cancellation events when GIG says Baci owns the waybill', async () => {
    const supabase = createSupabase();
    const attest = vi.fn().mockResolvedValue('owned');

    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', cancelledResult]]),
      attest
    );

    expect(summary.applied).toBe(1);
    expect(attest).toHaveBeenCalledWith('GIGL-1');
    const [cancelled, created] = appliedEvents(supabase.rpc);
    expect(cancelled).toMatchObject({
      account_attested: true,
      normalized_status: 'cancelled',
      provider_event_key: 'MSCC:1',
    });
    expect(created).not.toHaveProperty('account_attested');
  });

  it('sends no attestation for a waybill another GIG account owns', async () => {
    const supabase = createSupabase();

    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', cancelledResult]]),
      async () => 'not_owned' as const
    );

    expect(summary.applied).toBe(1);
    for (const event of appliedEvents(supabase.rpc)) {
      expect(event).not.toHaveProperty('account_attested');
    }
  });

  it.each([
    ['reports GIG as unavailable', async () => 'unavailable' as const],
    [
      'throws',
      async (): Promise<'owned'> => {
        throw new Error('GIG preshipment lookup failed for GIGL-1');
      },
    ],
  ])('bugfix: retries the poll instead of applying an unattested cancellation when the ownership check %s', async (_label, attest) => {
    const supabase = createSupabase();

    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', cancelledResult]]),
      attest
    );

    expect(summary).toMatchObject({ applied: 0, failed: 1 });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'apply_gigl_tracking_result',
      expect.anything()
    );
    expect(supabase.rpc).toHaveBeenCalledWith('record_gigl_tracking_failure', {
      p_error: 'GIGL preshipment ownership check unavailable',
      p_shipment_id: monitor.shipment_id,
      p_tracking_epoch_id: monitor.tracking_epoch_id,
      p_worker_id: 'worker-1',
    });
    expect(JSON.stringify(supabase.rpc.mock.calls)).not.toContain(
      'lookup failed'
    );
  });

  it('never looks up ownership for results that are not cancellations', async () => {
    const supabase = createSupabase();
    const attest = vi.fn().mockResolvedValue('owned');

    await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor],
      'worker-1',
      async () => new Map([['GIGL-1', inTransitResult]]),
      attest
    );

    expect(attest).not.toHaveBeenCalled();
    for (const event of appliedEvents(supabase.rpc)) {
      expect(event).not.toHaveProperty('account_attested');
    }
  });

  it('looks up a cancelled waybill once when two monitors share it', async () => {
    const supabase = createSupabase();
    const attest = vi.fn().mockResolvedValue('owned');
    const secondMonitor = {
      ...monitor,
      order_id: '00000000-0000-4000-8000-000000000004',
      shipment_id: '00000000-0000-4000-8000-000000000005',
      tracking_epoch_id: '00000000-0000-4000-8000-000000000006',
    };

    const summary = await processClaimedGiglTrackingMonitors(
      supabase as never,
      [monitor, secondMonitor],
      'worker-1',
      async () => new Map([['GIGL-1', cancelledResult]]),
      attest
    );

    expect(summary.applied).toBe(2);
    expect(attest).toHaveBeenCalledTimes(1);
  });
});
