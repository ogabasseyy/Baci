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

describe('bugfix: SDR keeps the aggregate failed without relabelling later events', () => {
  it('leaves later scans with their own event status so only SDR queues a failure', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W42',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('SDR', '10:00:00'),
          event('MSVC', '11:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
          event('MSHC', '12:00:00'),
        ],
      },
      'W42',
      OBSERVED_AT
    );
    expect(result.status).toBe('failed');
    expect(result.events.filter((e) => e.status === 'failed')).toHaveLength(1);
  });
});

describe('bugfix: terminal outcome survives a later progress scan; MSHC keeps its raw code', () => {
  it('stays delivered when an MSHC follows SHD', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W43',
        MobileShipmentTrackings: [
          event('SHD', '10:00:00'),
          event('MSHC', '12:00:00'),
        ],
      },
      'W43',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
  });

  it('restores the MSHC provider code after the parcel moved through the network', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W44',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('ARF', '10:00:00', { Location: 'WUSE ABUJA' }),
          event('MSHC', '12:00:00', {
            ScanStatusReason: 'RIDER EN ROUTE FOR PICKUP',
          }),
        ],
      },
      'W44',
      OBSERVED_AT
    );
    const mshc = result.events.find((e) => e.timestamp.getUTCHours() === 12);
    expect(mshc?.rawStatus).toBe('MSHC');
  });
});

describe('bugfix: only the first explicit arrival is rewritten', () => {
  it('rewrites a single event when two ARF scans are reported', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W47',
        MobileShipmentTrackings: [
          event('ARF', '10:00:00'),
          event('ARF', '12:00:00'),
        ],
      },
      'W47',
      OBSERVED_AT
    );
    expect(
      result.events.filter(
        (e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS
      )
    ).toHaveLength(1);
  });
});

describe('bugfix: tied location is only borrowed from an arrival scan', () => {
  it('does not copy a hub location onto a location-less delivered scan', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W48',
        MobileShipmentTrackings: [
          event('DPC', '10:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
          event('SHD', '10:00:00'),
        ],
      },
      'W48',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
    expect(result.events[0]?.location).toBeUndefined();
  });
});

describe('bugfix: a terminal outcome beats the SDR fence and owns the snapshot location', () => {
  it('stays delivered for SDR, SHD, then a newer scan on the first poll', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W45',
        MobileShipmentTrackings: [
          event('SDR', '10:00:00'),
          event('SHD', '11:00:00'),
          event('MSVC', '12:00:00'),
        ],
      },
      'W45',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
    expect(result.actualDelivery).toEqual(new Date('2026-11-09T11:00:00.000Z'));
  });

  it('still fails when the SDR is newer than the terminal scan', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W46',
        MobileShipmentTrackings: [
          event('SHD', '10:00:00'),
          event('SDR', '11:00:00'),
          event('MSVC', '12:00:00'),
        ],
      },
      'W46',
      OBSERVED_AT
    );
    expect(result.status).toBe('failed');
  });

  it('puts the terminal event first so its location is the current location', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W47',
        MobileShipmentTrackings: [
          event('SHD', '10:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
          event('MSVC', '12:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
        ],
      },
      'W47',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
    expect(result.events[0]?.location).toContain('WUSE ABUJA');
  });
});
