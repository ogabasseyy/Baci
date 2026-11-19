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
});
