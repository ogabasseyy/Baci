import { describe, expect, it } from 'vitest';
import { GIGL_ARRIVED_IN_CITY_RAW_STATUS } from '../gigl-tracking-notification-policy-matrix';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

const OBSERVED_AT = new Date('2026-11-10T00:00:00.000Z');

function event(
  status: string,
  time: string,
  extra: Record<string, string> = {}
) {
  return {
    Status: status,
    DateTimeUtc: `2026-11-09T${time}.000Z`,
    ...extra,
  };
}

describe('bugfix: SDR, international arrivals and equal-time location', () => {
  it('keeps SDR (destroyed) visible over a same-time MSHC in either payload order', () => {
    for (const order of [
      [event('SDR', '11:00:00'), event('MSHC', '11:00:00')],
      [event('MSHC', '11:00:00'), event('SDR', '11:00:00')],
    ]) {
      const result = normalizeGiglTrackingShipment(
        { Waybill: 'W30', MobileShipmentTrackings: order },
        'W30',
        OBSERVED_AT
      );
      expect(result.status).toBe('failed');
    }
  });

  it.each([
    'IAFDSC',
    'IAFDHD',
  ])('treats %s as an arrival without location or destination metadata', (code) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W31',
        MobileShipmentTrackings: [event(code, '12:00:00')],
      },
      'W31',
      OBSERVED_AT
    );
    expect(result.events[0]?.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
  });

  it('keeps the destination-centre location when a location-less MSHC shares the timestamp', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W32',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSHC', '11:00:00'),
          event('ARF', '11:00:00', { Location: 'WUSE ABUJA' }),
        ],
      },
      'W32',
      OBSERVED_AT
    );
    expect(result.events[0]?.location).toBe('WUSE ABUJA');
  });
});
