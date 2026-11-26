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

  it.each([
    ['SHD', 'terminal first'],
    ['SHD', 'arrival first'],
    ['MSCP', 'terminal first'],
    ['MSCP', 'arrival first'],
  ])('fences an arrival tied with %s (%s)', (terminal, order) => {
    const DateTimeUtc = '2026-11-09T10:00:00.000Z';
    const scans = [
      { Status: terminal, DateTimeUtc },
      { Status: 'ARF', DateTimeUtc, Location: 'WUSE ABUJA' },
    ];
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W95',
        Destination: 'ABUJA',
        MobileShipmentTrackings:
          order === 'arrival first' ? scans.reverse() : scans,
      },
      'W95',
      OBSERVED_AT
    );

    expect(result.events.map((e) => e.rawStatus)).not.toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });
});

describe('bugfix: tied failures and departure wording', () => {
  const run = (
    scans: Array<{
      Status: string;
      DateTimeUtc: string;
      Location?: string;
      ScanStatusReason?: string;
    }>
  ) =>
    normalizeGiglTrackingShipment(
      { Waybill: 'W95', Destination: 'ABUJA', MobileShipmentTrackings: scans },
      'W95',
      OBSERVED_AT
    ).events.map((e) => e.rawStatus);
  const DateTimeUtc = '2026-11-09T10:00:00.000Z';

  it.each([
    false,
    true,
  ])('keeps a tied terminal closed despite a tied failure (reversed: %s)', (reversed) => {
    const scans = [
      { Status: 'SHD', DateTimeUtc },
      {
        Status: 'DUBC',
        ScanStatusReason: 'DELIVERY_FAILED',
        DateTimeUtc,
        Location: 'IKEJA',
      },
      { Status: 'ARF', DateTimeUtc, Location: 'WUSE ABUJA' },
    ];
    expect(run(reversed ? scans.reverse() : scans)).not.toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it('does not treat an arrival code with departure wording as arrived', () => {
    expect(
      run([
        {
          Status: 'ARF',
          ScanStatusReason: 'SHIPMENT DEPARTED SERVICE CENTRE',
          DateTimeUtc,
        },
      ])
    ).not.toContain(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
  });
});
