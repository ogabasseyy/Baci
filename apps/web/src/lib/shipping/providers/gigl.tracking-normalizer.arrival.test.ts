import { describe, expect, it } from 'vitest';
import {
  GIGL_ARRIVED_IN_CITY_RAW_STATUS,
  GIGL_PICKUP_EN_ROUTE_RAW_STATUS,
  getGiglTrackingNotificationPolicies,
} from '../gigl-tracking-notification-policy-matrix';
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

describe('bugfix: GIG first-mile ENROUTE DELIVERY is not out-for-delivery (waybill 1349642447)', () => {
  const liveSequence = [
    event('MCRT', '13:23:23', {
      ScanStatusReason: 'SHIPMENT CREATED BY CUSTOMER',
    }),
    event('MAPT', '14:26:38'),
    event('MSHC', '15:42:35', {
      ScanStatusReason: 'SHIPMENT ENROUTE DELIVERY',
    }),
    event('MSVC', '16:59:25'),
    event('DSC', '17:08:30', { Location: 'IKEJA 2 (80, AWOLOWO WAY, IKEJA)' }),
    event('DPC', '18:28:16', { Location: 'IKEJA 2 (80, AWOLOWO WAY, IKEJA)' }),
  ];

  it('never reports out_for_delivery for the exact live event sequence', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: '1349642447',
        Destination: 'LAGOS',
        MobileShipmentTrackings: liveSequence,
      },
      '1349642447',
      OBSERVED_AT
    );

    expect(result.status).toBe('in_transit');
    expect(
      result.events.map((e) => e.status).filter((s) => s === 'out_for_delivery')
    ).toEqual([]);
    const enroute = result.events.find((e) =>
      e.description.includes('ENROUTE')
    );
    expect(enroute?.status).toBe('pickup_scheduled');
    expect(enroute?.rawStatus).toBe(GIGL_PICKUP_EN_ROUTE_RAW_STATUS);
  });

  it('still reports out_for_delivery for MSHC after arrival at the destination centre', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: '1349642447',
        Destination: 'LAGOS',
        MobileShipmentTrackings: [
          ...liveSequence,
          event('ARF', '20:00:00'),
          event('MSHC', '21:00:00'),
        ],
      },
      '1349642447',
      OBSERVED_AT
    );

    expect(result.status).toBe('out_for_delivery');
  });
});

describe('arrived in your city', () => {
  it('flags ARF (arrived final destination) as an arrival notification, still in_transit', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W1',
        MobileShipmentTrackings: [
          event('DPC', '10:00:00'),
          event('ARF', '11:00:00'),
        ],
      },
      'W1',
      OBSERVED_AT
    );

    const arrival = result.events.find(
      (e) =>
        e.providerEventKey &&
        e.status === 'in_transit' &&
        e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
    expect(arrival).toBeDefined();
    expect(result.status).toBe('in_transit');
    expect(
      getGiglTrackingNotificationPolicies(
        GIGL_ARRIVED_IN_CITY_RAW_STATUS,
        'in_transit'
      ).map((p) => `${p.audience}:${p.notificationKind}`)
    ).toEqual(['customer:arrived_in_city', 'customer:transit_started']);
  });

  it('flags an arrival event whose service centre matches the delivery city', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W2',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('DPC', '10:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
          event('MSVC', '11:00:00', {
            Location: 'GWAGWALADA (Abuja Road)',
            ScanStatusReason: 'SHIPMENT ARRIVED SERVICE CENTRE',
          }),
          event('MSVC', '12:00:00', {
            Location: 'WUSE ABUJA (Wuse)',
            ScanStatusReason: 'SHIPMENT ARRIVED SERVICE CENTRE',
          }),
        ],
      },
      'W2',
      OBSERVED_AT
    );

    const raws = result.events.map((e) => e.rawStatus);
    expect(
      raws.filter((r) => r === GIGL_ARRIVED_IN_CITY_RAW_STATUS)
    ).toHaveLength(1);
    expect(result.events.some((e) => e.rawStatus === 'DPC')).toBe(true);
  });

  it('does not flag an arrival at a different city than the delivery city', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W3',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSVC', '11:00:00', {
            Location: 'IKEJA 2 (IKEJA)',
            ScanStatusReason: 'SHIPMENT ARRIVED SERVICE CENTRE',
          }),
        ],
      },
      'W3',
      OBSERVED_AT
    );

    expect(result.events[0]?.rawStatus).toBe('MSVC');
  });
});

describe('in-transit notification is sent once per shipment', () => {
  it('maps every hub depart/arrive to the same policy so the outbox unique key dedupes it', () => {
    const kinds = ['MSVC', 'DSC', 'DPC', 'ACC'].flatMap((raw) =>
      getGiglTrackingNotificationPolicies(raw, 'in_transit').map(
        (p) => p.notificationKind
      )
    );
    expect(new Set(kinds)).toEqual(new Set(['transit_started']));
  });
});

describe('review hardening: destination matching', () => {
  const run = (
    destination: string | undefined,
    location: string,
    code = 'MSVC'
  ) =>
    normalizeGiglTrackingShipment(
      {
        Waybill: 'W9',
        Destination: destination,
        MobileShipmentTrackings: [
          event(code, '11:00:00', { Location: location }),
        ],
      },
      'W9',
      OBSERVED_AT
    ).events[0]?.rawStatus;

  it('does not treat ABAKALIKI as arrival for destination ABA', () => {
    expect(run('ABA', 'ABAKALIKI (CENTRAL PARK)')).toBe('MSVC');
  });
  it('does not treat LONDON as arrival for destination ONDO', () => {
    expect(run('ONDO', 'LONDON (X)')).toBe('MSVC');
  });
  it('matches FCT ABUJA against an Abuja centre from the code alone', () => {
    expect(run('FCT ABUJA', 'WUSE ABUJA (Wuse)')).toBe(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });
  it('does not treat a departure from the destination city as arrival', () => {
    expect(run('ABUJA', 'WUSE ABUJA (Wuse)', 'DSC')).toBe('DSC');
  });
  it('treats MSHC after the parcel moved through centres as out_for_delivery even when the centre name differs from the destination (IKEJA vs LAGOS)', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W10',
        Destination: 'LAGOS',
        MobileShipmentTrackings: [
          event('DPC', '10:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
          event('MSHC', '11:00:00'),
        ],
      },
      'W10',
      OBSERVED_AT
    );
    expect(result.status).toBe('out_for_delivery');
  });
  it('demotes MSHC before any movement even when the destination is unknown', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W11',
        MobileShipmentTrackings: [
          event('MAPT', '10:00:00'),
          event('MSHC', '11:00:00'),
        ],
      },
      'W11',
      OBSERVED_AT
    );
    expect(result.status).toBe('pickup_scheduled');
  });
});

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
