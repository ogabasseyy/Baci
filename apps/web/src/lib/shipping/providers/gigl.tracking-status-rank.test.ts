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
      currentStatusRank(scan('SDR', 'failed'))
    );
  });
});
