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

describe('bugfix: exception scans and more explicit arrival codes', () => {
  it.each([
    'DASH',
    'CLS',
  ])('does not infer an arrival from the %s exception scan at the destination centre', (code) => {
    const away = scan('MSVC', 'in_transit', 9, 'IKEJA');
    const exc = scan(code, 'in_transit', 12, 'WUSE ABUJA');
    applyLifecycleGuards([away, exc], 'ABUJA', 'LAGOS');
    expect(exc.event.rawStatus).toBe(code);
  });

  it.each([
    ['ADF', 'in_transit'],
    ['ARFTPKU', null],
  ] as const)('treats %s as an explicit arrival without location metadata', (code, recognized) => {
    const evt = scan(code, recognized, 12);
    applyLifecycleGuards([evt], 'ABUJA', 'LAGOS');
    expect(evt.event.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
    expect(evt.event.status).toBe('in_transit');
  });
});

describe('bugfix: IDK/IDH departures and Go Faster arrivals', () => {
  it.each([
    'IDK',
    'IDH',
  ])('does not infer an arrival from the %s departure scan at the destination office', (code) => {
    const away = scan('MSVC', 'in_transit', 9, 'LAGOS');
    const dep = scan(code, 'in_transit', 12, 'LONDON OFFICE');
    applyLifecycleGuards([away, dep], 'LONDON', 'LAGOS');
    expect(dep.event.rawStatus).toBe(code);
  });

  it.each([
    'ARFGFR',
    'ARFGFS',
  ])('treats %s as an explicit arrival without location metadata', (code) => {
    const evt = scan(code, null, 12);
    applyLifecycleGuards([evt], 'ABUJA', 'LAGOS');
    expect(evt.event.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
  });
});

describe('bugfix: delay, customs and transfer scans are not arrivals', () => {
  it.each([
    'DLD',
    'CLC',
    'UCC',
    'GOP',
    'TRO',
    'SRIC',
  ])('does not infer an arrival from the %s scan at the destination centre', (code) => {
    const away = scan('MSVC', 'in_transit', 9, 'IKEJA');
    const evt = scan(code, 'in_transit', 12, 'WUSE ABUJA');
    applyLifecycleGuards([away, evt], 'ABUJA', 'LAGOS');
    expect(evt.event.rawStatus).toBe(code);
  });
});

describe('bugfix: an arrival after SDR does not revive the destroyed shipment', () => {
  it('leaves a later arrival scan unrewritten once SDR was seen', () => {
    const sdr = scan('SDR', 'failed', 9);
    const arf = scan('ARF', 'in_transit', 12);
    applyLifecycleGuards([sdr, arf], 'ABUJA', 'LAGOS');
    expect(arf.event.rawStatus).toBe('ARF');
  });
});

describe('bugfix: foreign-office arrivals need a matching destination', () => {
  it.each([
    ['ARFK', 'LONDON UK', true],
    ['ARFP', 'ABUJA', false],
    ['ARFH', 'HOUSTON', true],
    ['ARUS', 'USA', true],
    ['ARUS', 'ABUJA', false],
    ['ARFK', 'ABUJA', false],
  ] as const)('%s with destination %s promotes: %s', (code, dest, promoted) => {
    const evt = scan(code, null, 12);
    applyLifecycleGuards([evt], dest, 'LAGOS');
    expect(evt.event.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS).toBe(
      promoted
    );
  });
});
