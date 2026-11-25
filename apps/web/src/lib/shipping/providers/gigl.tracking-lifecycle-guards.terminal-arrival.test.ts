import { describe, expect, it } from 'vitest';
import { GIGL_ARRIVED_IN_CITY_RAW_STATUS } from '../gigl-tracking-notification-policy-matrix';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

const OBSERVED_AT = new Date('2026-11-10T00:00:00.000Z');

describe('bugfix: no arrival update after a terminal outcome', () => {
  it.each([
    'SHD',
    'MSCP',
  ])('does not promote an arrival scanned after %s', (terminal) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W95',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          { Status: terminal, DateTimeUtc: '2026-11-09T10:00:00.000Z' },
          {
            Status: 'ARF',
            DateTimeUtc: '2026-11-09T12:00:00.000Z',
            Location: 'WUSE ABUJA',
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
