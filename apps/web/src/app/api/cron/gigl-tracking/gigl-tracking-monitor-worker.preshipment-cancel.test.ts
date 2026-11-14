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

const bookedResult: TrackingResult = {
  carrierName: 'GIG Logistics',
  events: [
    {
      description: 'Shipment created',
      providerEventKey: 'MCRT:1',
      rawStatus: 'MCRT',
      status: 'booked',
      timestamp: new Date('2026-11-02T05:33:03.500Z'),
    },
  ],
  hasRecognizedLifecycleEvent: true,
  provider: 'GIGL',
  status: 'booked',
  trackingNumber: 'GIGL-1',
};

type WorkerClient = Parameters<typeof processClaimedGiglTrackingMonitors>[0];

function toWorkerClient(rpc: ReturnType<typeof vi.fn>): WorkerClient {
  return { rpc } as unknown as WorkerClient;
}

function setup(cancellation: 'cancelled' | 'active' | 'unknown') {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const readCancellation = vi.fn().mockResolvedValue(cancellation);
  const attest = vi.fn().mockResolvedValue('owned');
  return { rpc, readCancellation, attest };
}

async function run(
  s: ReturnType<typeof setup>,
  results: Map<string, TrackingResult>
) {
  return processClaimedGiglTrackingMonitors(
    toWorkerClient(s.rpc),
    [monitor],
    'worker-1',
    async () => results,
    s.attest,
    s.readCancellation
  );
}

function applyArgs(rpc: ReturnType<typeof setup>['rpc']) {
  const call = rpc.mock.calls.find(
    ([name]) => name === 'apply_gigl_tracking_result'
  );
  return call?.[1] as
    | { p_status: string; p_events: Record<string, unknown>[] }
    | undefined;
}

describe('bugfix: waybill cancelled in the GIG app never reached the tracker', () => {
  it('applies a cancellation when the track feed is active but preshipment IsCancelled', async () => {
    const s = setup('cancelled');
    const summary = await run(s, new Map([['GIGL-1', bookedResult]]));

    expect(summary.applied).toBe(1);
    const args = applyArgs(s.rpc);
    expect(args?.p_status).toBe('cancelled');
    expect(args?.p_events[0]).toMatchObject({
      account_attested: true,
      normalized_status: 'cancelled',
      provider_event_key: 'preshipment-cancelled:GIGL-1',
    });
    // The original track events are preserved after the synthetic one.
    expect(args?.p_events).toHaveLength(2);
  });

  it('cancels even when the track feed omitted the waybill', async () => {
    const s = setup('cancelled');
    const summary = await run(s, new Map());
    expect(summary.applied).toBe(1);
    expect(applyArgs(s.rpc)?.p_status).toBe('cancelled');
  });

  it('keeps the track status when preshipment is not cancelled', async () => {
    const s = setup('active');
    await run(s, new Map([['GIGL-1', bookedResult]]));
    expect(applyArgs(s.rpc)?.p_status).toBe('booked');
  });

  it('keeps the track status when the preshipment read is unknown', async () => {
    const s = setup('unknown');
    await run(s, new Map([['GIGL-1', bookedResult]]));
    expect(applyArgs(s.rpc)?.p_status).toBe('booked');
  });

  it('does not read preshipment when the feed already shows a terminal status', async () => {
    const s = setup('cancelled');
    await run(
      s,
      new Map([['GIGL-1', { ...bookedResult, status: 'delivered' as const }]])
    );
    expect(s.readCancellation).not.toHaveBeenCalled();
  });
});
