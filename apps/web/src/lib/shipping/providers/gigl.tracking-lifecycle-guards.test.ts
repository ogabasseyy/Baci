import { describe, expect, it } from 'vitest';
import {
  GIGL_ARRIVED_IN_CITY_RAW_STATUS,
  GIGL_PICKUP_EN_ROUTE_RAW_STATUS,
} from '@/lib/shipping/gigl-tracking-notification-policy-matrix';
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

  it('does not treat a DEPARTED provider status at destination with empty scanText as arrival', () => {
    const departed = {
      ...scan('DEPARTED', 'in_transit', 11, 'WUSE ABUJA (Wuse)'),
      scanText: '',
    };
    applyLifecycleGuards([departed], 'ABUJA', 'LAGOS');
    expect(departed.event.rawStatus).toBe('DEPARTED');
  });

  it('needs a located scan away from the destination before a same-city name match counts', () => {
    const noLocation = scan('MSVC', 'in_transit', 9);
    const atOrigin = scan('MSVC', 'in_transit', 11, 'WUSE ABUJA (Wuse)');
    applyLifecycleGuards([noLocation, atOrigin], 'ABUJA', 'ABUJA');
    expect(atOrigin.event.rawStatus).toBe('MSVC');
  });

  it('bugfix: reason text that merely contains DEPART as part of another word does not block an arrival', () => {
    const arrival = {
      ...scan('MSVC', 'in_transit', 11, 'WUSE ABUJA (Wuse)'),
      scanText: 'RECEIVED AT DEPARTMENT STORE COUNTER',
    };
    applyLifecycleGuards(
      [scan('DPC', 'in_transit', 9, 'IKEJA 2 (IKEJA)'), arrival],
      'ABUJA',
      'LAGOS'
    );
    expect(arrival.event.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
  });

  it('bugfix: a code-only MDSE (departs service centre) at the destination is not an arrival', () => {
    const mdse = {
      ...scan('MDSE', 'in_transit', 11, 'WUSE ABUJA (Wuse)'),
      scanText: '',
    };
    applyLifecycleGuards([mdse], 'ABUJA', 'LAGOS');
    expect(mdse.event.rawStatus).toBe('MDSE');
  });

  it('flags MAFD as an explicit arrival even without a location or destination', () => {
    const mafd = scan('MAFD', 'in_transit', 11);
    applyLifecycleGuards([mafd], undefined, undefined);
    expect(mafd.event.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
  });

  it('bugfix: a same-city pickup at a non-matching location does not prove the parcel left the city', () => {
    const pickup = scan('MPIK', 'picked_up', 9, 'GARKI (Garki)');
    const hub = scan('MSVC', 'in_transit', 11, 'WUSE ABUJA (Wuse)');
    applyLifecycleGuards([pickup, hub], 'ABUJA', 'ABUJA');
    expect(hub.event.rawStatus).toBe('MSVC');
  });
});
