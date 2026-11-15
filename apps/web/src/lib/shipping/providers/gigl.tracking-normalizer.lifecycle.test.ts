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

describe('bugfix: MSHC after an explicit out-for-delivery scan is not demoted to pickup', () => {
  it.each([
    'WC',
    'OFDU',
  ])('keeps out_for_delivery for %s followed by MSHC with no earlier transit scans', (code) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W12',
        MobileShipmentTrackings: [
          event(code, '10:00:00'),
          event('MSHC', '11:00:00'),
        ],
      },
      'W12',
      OBSERVED_AT
    );
    expect(result.status).toBe('out_for_delivery');
    expect(result.events.some((e) => e.status === 'pickup_scheduled')).toBe(
      false
    );
  });
});

describe('bugfix: MSHC retry after a failed delivery attempt is not demoted to pickup', () => {
  it('keeps out_for_delivery for SDR followed by MSHC with no earlier transit scans', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W13',
        MobileShipmentTrackings: [
          event('SDR', '10:00:00'),
          event('MSHC', '11:00:00'),
        ],
      },
      'W13',
      OBSERVED_AT
    );
    expect(result.status).toBe('out_for_delivery');
    expect(result.events.some((e) => e.status === 'pickup_scheduled')).toBe(
      false
    );
  });
});

describe('bugfix: same-city shipments and pickup-reason MSHC', () => {
  it('does not flag the first origin scan as arrival when origin and destination are the same city', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W14',
        Origin: 'ABUJA',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSVC', '10:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
        ],
      },
      'W14',
      OBSERVED_AT
    );
    expect(result.events[0]?.rawStatus).toBe('MSVC');
  });

  it('still flags an explicit ARF for a same-city shipment', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W15',
        Origin: 'ABUJA',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [event('ARF', '10:00:00')],
      },
      'W15',
      OBSERVED_AT
    );
    expect(result.events[0]?.rawStatus).toBe(GIGL_ARRIVED_IN_CITY_RAW_STATUS);
  });

  it('demotes MSHC carrying the pickup-en-route reason when no movement happened', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W16',
        MobileShipmentTrackings: [
          event('MSHC', '10:00:00', {
            ScanStatusReason: 'RIDER EN ROUTE FOR PICKUP',
          }),
        ],
      },
      'W16',
      OBSERVED_AT
    );
    expect(result.status).toBe('pickup_scheduled');
  });
});

describe('bugfix: pickup completion alone is not network movement', () => {
  it('keeps MSHC after MPIK in the first-mile state', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W17',
        MobileShipmentTrackings: [
          event('MAPT', '09:00:00'),
          event('MPIK', '10:00:00'),
          event('MSHC', '11:00:00'),
        ],
      },
      'W17',
      OBSERVED_AT
    );
    expect(result.status).not.toBe('out_for_delivery');
    expect(result.events.some((e) => e.status === 'out_for_delivery')).toBe(
      false
    );
  });
});

describe('bugfix: equal-timestamp MSHC and arrival', () => {
  it('keeps out_for_delivery when MSHC and ARF share a timestamp and MSHC comes first', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W18',
        MobileShipmentTrackings: [
          event('MSHC', '11:00:00'),
          event('ARF', '11:00:00'),
        ],
      },
      'W18',
      OBSERVED_AT
    );
    expect(result.status).toBe('out_for_delivery');
  });

  it('keeps out_for_delivery when MSHC and ARF share a timestamp and ARF comes first', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W19',
        MobileShipmentTrackings: [
          event('ARF', '11:00:00'),
          event('MSHC', '11:00:00'),
        ],
      },
      'W19',
      OBSERVED_AT
    );
    expect(result.status).toBe('out_for_delivery');
  });
});

describe('bugfix: equal-timestamp delivery scan outranks MSHC', () => {
  it.each([
    ['delivery first', ['SHD', 'MSHC']],
    ['MSHC first', ['MSHC', 'SHD']],
  ])('keeps delivered when SHD and MSHC share a timestamp (%s)', (_label, codes) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W20',
        MobileShipmentTrackings: [
          event('ARF', '09:00:00'),
          ...codes.map((code) => event(code, '11:00:00')),
        ],
      },
      'W20',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
    expect(result.actualDelivery).toBeInstanceOf(Date);
  });
});

describe('bugfix: equal-timestamp MPIK vs demoted MSHC, and repeated origin scans', () => {
  it.each([
    ['MPIK first', ['MPIK', 'MSHC']],
    ['MSHC first', ['MSHC', 'MPIK']],
  ])('keeps picked_up when MPIK and a demoted MSHC share a timestamp (%s)', (_l, codes) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W21',
        MobileShipmentTrackings: codes.map((c) => event(c, '10:00:00')),
      },
      'W21',
      OBSERVED_AT
    );
    expect(result.status).not.toBe('pickup_scheduled');
  });

  it('does not treat a repeated origin scan as arrival for a same-city shipment', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W22',
        Origin: 'ABUJA',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSVC', '10:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
          event('MSVC', '11:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
        ],
      },
      'W22',
      OBSERVED_AT
    );
    expect(
      result.events.some((e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS)
    ).toBe(false);
  });
});

describe('bugfix: equal-timestamp returned/cancelled scans outrank MSHC', () => {
  it.each([
    ['SRHUB', 'returned'],
    ['MSCP', 'cancelled'],
  ])('keeps %s terminal over a same-time MSHC in either order', (code, expected) => {
    for (const codes of [
      [code, 'MSHC'],
      ['MSHC', code],
    ]) {
      const result = normalizeGiglTrackingShipment(
        {
          Waybill: 'W23',
          MobileShipmentTrackings: [
            event('ARF', '09:00:00'),
            ...codes.map((c) => event(c, '11:00:00')),
          ],
        },
        'W23',
        OBSERVED_AT
      );
      expect(result.status).toBe(expected);
    }
  });
});
