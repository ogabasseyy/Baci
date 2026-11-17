import { describe, expect, it } from 'vitest';
import {
  GIGL_ARRIVED_IN_CITY_RAW_STATUS,
  GIGL_PICKUP_EN_ROUTE_RAW_STATUS,
} from '@/lib/shipping/gigl-tracking-notification-policy-matrix';
import type { TrackingEvent } from '../types';
import {
  applyLifecycleGuards,
  currentStatusRank,
  type Guardable,
} from './gigl.tracking-lifecycle-guards';

function scan(
  providerStatus: string,
  recognizedStatus: TrackingEvent['status'] | null,
  hour: number,
  location?: string
): Guardable {
  return {
    providerStatus,
    recognizedStatus,
    event: {
      status: recognizedStatus ?? 'in_transit',
      rawStatus: providerStatus,
      description: providerStatus,
      location,
      timestamp: new Date(Date.UTC(2026, 10, 9, hour)),
    } as TrackingEvent,
  };
}

describe('applyLifecycleGuards', () => {
  it('demotes MSHC before any movement to the pickup-en-route state', () => {
    const mshc = scan('MSHC', 'out_for_delivery', 10);
    applyLifecycleGuards([mshc], 'ABUJA', 'LAGOS');
    expect(mshc.event.status).toBe('pickup_scheduled');
    expect(mshc.event.rawStatus).toBe(GIGL_PICKUP_EN_ROUTE_RAW_STATUS);
  });

  it('keeps MSHC as picked_up with its provider raw status once pickup completed', () => {
    const mpik = scan('MPIK', 'picked_up', 10);
    const mshc = scan('MSHC', 'out_for_delivery', 11);
    mshc.event.rawStatus = GIGL_PICKUP_EN_ROUTE_RAW_STATUS;
    applyLifecycleGuards([mpik, mshc], 'ABUJA', 'LAGOS');
    expect(mshc.event.status).toBe('picked_up');
    expect(mshc.event.rawStatus).toBe('MSHC');
  });

  it('keeps MSHC out_for_delivery after the parcel moved through the network', () => {
    const transit = scan('MSVC', 'in_transit', 9, 'IKEJA 2 (IKEJA)');
    const mshc = scan('MSHC', 'out_for_delivery', 11);
    applyLifecycleGuards([transit, mshc], 'LAGOS', 'ABUJA');
    expect(mshc.event.status).toBe('out_for_delivery');
  });

  it('marks ARF as arrival and processes a same-time MSHC after it', () => {
    const mshc = scan('MSHC', 'out_for_delivery', 11);
    const arf = scan('ARF', 'in_transit', 11);
    applyLifecycleGuards([mshc, arf], 'ABUJA', 'LAGOS');
    expect(arf.event.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
    expect(mshc.event.status).toBe('out_for_delivery');
  });

  it('does not treat a departure code at the destination centre as arrival', () => {
    const dsc = scan('DSC', 'in_transit', 11, 'WUSE ABUJA (Wuse)');
    applyLifecycleGuards([dsc], 'ABUJA', 'LAGOS');
    expect(dsc.event.rawStatus).toBe('DSC');
  });

  it('needs a located scan away from the destination before a same-city name match counts', () => {
    const noLocation = scan('MSVC', 'in_transit', 9);
    const atOrigin = scan('MSVC', 'in_transit', 11, 'WUSE ABUJA (Wuse)');
    applyLifecycleGuards([noLocation, atOrigin], 'ABUJA', 'ABUJA');
    expect(atOrigin.event.rawStatus).toBe('MSVC');
  });
});

describe('currentStatusRank', () => {
  it('ranks terminal above MSHC above other scans above pickup-scheduled', () => {
    const terminal = currentStatusRank(scan('SHD', 'delivered', 10));
    const mshc = currentStatusRank(scan('MSHC', 'out_for_delivery', 10));
    const other = currentStatusRank(scan('MSVC', 'in_transit', 10));
    const pickup = currentStatusRank(scan('MSHC', 'pickup_scheduled', 10));
    expect(terminal).toBeGreaterThan(mshc);
    expect(mshc).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(pickup);
  });
});
