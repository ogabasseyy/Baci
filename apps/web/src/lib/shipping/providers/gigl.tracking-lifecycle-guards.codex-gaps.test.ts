import { describe, expect, it } from 'vitest';
import { GIGL_ARRIVED_IN_CITY_RAW_STATUS } from '@/lib/shipping/gigl-tracking-notification-policy-matrix';
import type { TrackingEvent } from '../types';
import { applyLifecycleGuards } from './gigl.tracking-lifecycle-guards';
import type { Guardable } from './gigl.tracking-status-rank';

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
      status: recognizedStatus ?? 'pending',
      rawStatus: providerStatus,
      description: providerStatus,
      location,
      timestamp: new Date(Date.UTC(2026, 10, 9, hour)),
    } as TrackingEvent,
  };
}

describe('bugfix: AHD and return scans in arrival inference', () => {
  it('treats AHD without location or destination match as an explicit arrival', () => {
    const ahd = scan('AHD', null, 12);
    applyLifecycleGuards([ahd], 'ABUJA', 'LAGOS');
    expect(ahd.event.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
    expect(ahd.event.status).toBe('in_transit');
  });

  it.each([
    'SRC',
    'MRTE',
    'SSR',
  ])('does not infer an arrival from the %s return scan at the destination centre', (code) => {
    const away = scan('MSVC', 'in_transit', 9, 'IKEJA');
    const ret = scan(code, 'in_transit', 12, 'ABUJA SERVICE CENTRE');
    applyLifecycleGuards([away, ret], 'ABUJA', 'LAGOS');
    expect(ret.event.rawStatus).toBe(code);
  });
});

describe('bugfix: DEPARTS wording is a departure, not an arrival', () => {
  it.each([
    'SHIPMENT DEPARTS SERVICE CENTRE',
    'DEPARTURES LOGGED',
  ])('does not infer an arrival from "%s" at the destination centre', (text) => {
    const away = scan('MSVC', 'in_transit', 9, 'IKEJA');
    const dep = scan('XYZ', 'in_transit', 12, 'ABUJA SERVICE CENTRE');
    dep.scanText = text;
    applyLifecycleGuards([away, dep], 'ABUJA', 'LAGOS');
    expect(dep.event.rawStatus).toBe('XYZ');
  });
});
