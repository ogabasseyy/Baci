import { describe, expect, it } from 'vitest';
import type { TrackingEvent } from '../types';
import { currentStatusRank, type Guardable } from './gigl.tracking-status-rank';

function scan(
  providerStatus: string,
  recognizedStatus: TrackingEvent['status'] | null
): Guardable {
  return {
    providerStatus,
    recognizedStatus,
    event: {
      status: recognizedStatus ?? 'in_transit',
      rawStatus: providerStatus,
      description: providerStatus,
      timestamp: new Date(Date.UTC(2026, 10, 9, 10)),
    } as TrackingEvent,
  };
}

describe('currentStatusRank', () => {
  it('ranks terminal above MSHC above other scans above pickup-scheduled', () => {
    const terminal = currentStatusRank(scan('SHD', 'delivered'));
    const mshc = currentStatusRank(scan('MSHC', 'out_for_delivery'));
    const other = currentStatusRank(scan('MSVC', 'in_transit'));
    const pickup = currentStatusRank(scan('MSHC', 'pickup_scheduled'));
    expect(terminal).toBeGreaterThan(mshc);
    expect(mshc).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(pickup);
  });

  it('lets a retry MSHC outrank a same-time failed scan (retry after a failed attempt)', () => {
    expect(currentStatusRank(scan('MSHC', 'out_for_delivery'))).toBeGreaterThan(
      currentStatusRank(scan('DELIVERY_FAILED', 'failed'))
    );
  });

  it('does not rank a genuine pickup assignment below same-time shipment creation', () => {
    expect(currentStatusRank(scan('MAPT', 'pickup_scheduled'))).toBeGreaterThan(
      currentStatusRank(scan('MCRT', 'booked'))
    );
  });

  it('keeps a demoted pickup-run MSHC above same-time shipment creation but below completed pickup', () => {
    const demoted = currentStatusRank(scan('MSHC', 'pickup_scheduled'));
    expect(demoted).toBeGreaterThan(currentStatusRank(scan('MCRT', 'booked')));
    expect(demoted).toBeLessThan(currentStatusRank(scan('MSVC', 'picked_up')));
  });

  it('bugfix: ranks a pending scan below shipment creation and pickup so same-time lifecycle milestones win', () => {
    const pending = currentStatusRank(scan('PENDING', 'pending'));
    expect(pending).toBeLessThan(currentStatusRank(scan('MCRT', 'booked')));
    expect(pending).toBeLessThan(
      currentStatusRank(scan('MSHC', 'pickup_scheduled'))
    );
  });
});
