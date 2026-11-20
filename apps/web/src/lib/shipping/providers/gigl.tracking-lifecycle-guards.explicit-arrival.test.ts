import { describe, expect, it } from 'vitest';
import { GIGL_ARRIVED_IN_CITY_RAW_STATUS } from '../gigl-tracking-notification-policy-matrix';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

const OBSERVED_AT = new Date('2026-11-10T00:00:00.000Z');
const T = '2026-11-09T12:00:00.000Z';

describe('bugfix: explicit arrival codes and tied or mapped scans', () => {
  it('does not give an explicit arrival code the arrival raw status when its reason maps to a failed attempt', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W90',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          {
            Status: 'AHD',
            DateTimeUtc: T,
            ScanStatusReason: 'DELIVERY_FAILED',
          },
        ],
      },
      'W90',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).not.toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it.each([
    ['location-less first', ['AD', 'ARF']],
    ['located first', ['ARF', 'AD']],
  ])('gives the located arrival the synthetic status when two explicit arrivals tie (%s)', (_label, order) => {
    const scans = {
      AD: { Status: 'AD', DateTimeUtc: T },
      ARF: { Status: 'ARF', DateTimeUtc: T, Location: 'WUSE ABUJA (Wuse)' },
    };
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W91',
        Destination: 'ABUJA',
        MobileShipmentTrackings: order.map((key) => scans[key as 'AD' | 'ARF']),
      },
      'W91',
      OBSERVED_AT
    );
    const arrival = result.events.find(
      (e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
    expect(arrival?.location).toContain('WUSE ABUJA');
  });

  it('recognises an RSR-only poll so monitoring is not paused', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W92',
        MobileShipmentTrackings: [{ Status: 'RSR', DateTimeUtc: T }],
      },
      'W92',
      OBSERVED_AT
    );
    expect(result.hasRecognizedLifecycleEvent).toBe(true);
  });

  it.each([
    ['location-less first', ['plain', 'located']],
    ['located first', ['located', 'plain']],
  ])('gives the located foreign-office arrival the synthetic status when two tie (%s)', (_label, order) => {
    const scans = {
      plain: { Status: 'ARFK', DateTimeUtc: T },
      located: {
        Status: 'ARFK',
        DateTimeUtc: T,
        Location: 'HEATHROW LONDON (UK)',
      },
    };
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W93',
        Destination: 'LONDON',
        MobileShipmentTrackings: order.map(
          (key) => scans[key as 'plain' | 'located']
        ),
      },
      'W93',
      OBSERVED_AT
    );
    const arrival = result.events.find(
      (e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
    expect(arrival?.location).toContain('HEATHROW');
  });

  it.each([
    ['location-less ARF first', ['ARF', 'MSVC']],
    ['located MSVC first', ['MSVC', 'ARF']],
  ])('gives a located inferred arrival the synthetic status over a tied location-less explicit one (%s)', (_label, order) => {
    const scans = {
      ARF: { Status: 'ARF', DateTimeUtc: T },
      MSVC: { Status: 'MSVC', DateTimeUtc: T, Location: 'WUSE ABUJA (Wuse)' },
    };
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W94',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: order.map(
          (key) => scans[key as 'ARF' | 'MSVC']
        ),
      },
      'W94',
      OBSERVED_AT
    );
    expect(result.events[0]?.location).toContain('WUSE ABUJA');
  });

  it('does not infer an arrival when the departure wording is in ScanStatusComment', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W95',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          {
            Status: 'MSVC',
            DateTimeUtc: T,
            Location: 'WUSE ABUJA (Wuse)',
            ScanStatusComment: 'SHIPMENT DEPARTED SERVICE CENTRE',
          },
        ],
      },
      'W95',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).not.toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });
});
