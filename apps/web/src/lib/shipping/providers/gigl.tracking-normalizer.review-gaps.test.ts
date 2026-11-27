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

  it.each([
    ['DPC first', ['DPC', 'ARF']],
    ['ARF first', ['ARF', 'DPC']],
  ] as const)('uses the tied arrival location, not an away scan (%s)', (_name, order) => {
    const locations: Record<string, string> = {
      DPC: 'IKEJA 2 (IKEJA)',
      ARF: 'WUSE ABUJA',
    };
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W33',
        Destination: 'ABUJA',
        Origin: 'LAGOS',
        MobileShipmentTrackings: [
          event('MSHC', '11:00:00'),
          ...order.map((code) =>
            event(code, '11:00:00', { Location: locations[code] })
          ),
        ],
      },
      'W33',
      OBSERVED_AT
    );
    expect(result.events[0]?.location).toBe('WUSE ABUJA');
  });

  it.each([
    ['unknown first', ['ZZUNK', 'MAPT']],
    ['MAPT first', ['MAPT', 'ZZUNK']],
  ] as const)('ranks an unrecognized tied scan below the lifecycle milestone (%s)', (_name, order) => {
    const locations: Record<string, string> = {
      ZZUNK: 'SOMEWHERE ELSE',
      MAPT: 'IKEJA 2 (IKEJA)',
    };
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W34',
        MobileShipmentTrackings: order.map((code) =>
          event(code, '09:00:00', { Location: locations[code] })
        ),
      },
      'W34',
      OBSERVED_AT
    );
    expect(result.events[0]?.location).toBe('IKEJA 2 (IKEJA)');
  });
});

describe('bugfix: a destroyed shipment (SDR) is never revived by a later MSHC', () => {
  it('keeps failed when MSHC arrives after SDR', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W35',
        MobileShipmentTrackings: [
          event('SDR', '10:00:00'),
          event('MSHC', '12:00:00'),
        ],
      },
      'W35',
      OBSERVED_AT
    );
    expect(result.status).toBe('failed');
    expect(result.events.find((e) => e.rawStatus === 'MSHC')?.status).toBe(
      'out_for_delivery'
    );
  });
});

describe('bugfix: tied out-for-delivery scan outranks tied in-transit', () => {
  it.each([
    ['WC first', ['WC', 'MSVC']],
    ['MSVC first', ['MSVC', 'WC']],
  ] as const)('reports out_for_delivery (%s)', (_name, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W36',
        MobileShipmentTrackings: order.map((code) => event(code, '10:00:00')),
      },
      'W36',
      OBSERVED_AT
    );
    expect(result.status).toBe('out_for_delivery');
  });
});

describe('bugfix: any later scan after SDR keeps the shipment failed', () => {
  it.each(['ARF', 'MSVC'])('keeps failed when %s follows SDR', (code) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W37',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('SDR', '10:00:00'),
          event(code, '12:00:00', { Location: 'WUSE ABUJA' }),
        ],
      },
      'W37',
      OBSERVED_AT
    );
    expect(result.status).toBe('failed');
  });
});

describe('bugfix: tied terminal order and same-time ARF with SDR', () => {
  it.each([
    ['SHD first', ['SHD', 'SRHUB']],
    ['SRHUB first', ['SRHUB', 'SHD']],
  ] as const)('ranks returned above delivered when tied (%s)', (_n, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W38',
        MobileShipmentTrackings: order.map((code) => event(code, '10:00:00')),
      },
      'W38',
      OBSERVED_AT
    );
    expect(result.status).toBe('returned');
  });

  it.each([
    ['ARF first', ['ARF', 'SDR']],
    ['SDR first', ['SDR', 'ARF']],
  ] as const)('keeps no arrival raw when ARF ties SDR (%s)', (_n, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W39',
        Destination: 'ABUJA',
        MobileShipmentTrackings: order.map((code) =>
          event(code, '10:00:00', { Location: 'WUSE ABUJA' })
        ),
      },
      'W39',
      OBSERVED_AT
    );
    expect(result.status).toBe('failed');
    expect(
      result.events.some((e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS)
    ).toBe(false);
  });
});

describe('bugfix: terminal outcome outranks a tied SDR', () => {
  it.each([
    ['SDR first', ['SDR', 'SHD']],
    ['SHD first', ['SHD', 'SDR']],
  ] as const)('reports delivered (%s)', (_n, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W40',
        MobileShipmentTrackings: order.map((code) => event(code, '10:00:00')),
      },
      'W40',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
  });
});

describe('bugfix: only the first destination scan becomes the inferred arrival', () => {
  it('rewrites a single event when two hub scans at the destination follow transit', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W41',
        Destination: 'ABUJA',
        Origin: 'LAGOS',
        MobileShipmentTrackings: [
          event('MSVC', '08:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
          event('MSVC', '10:00:00', { Location: 'WUSE ABUJA' }),
          event('MSVC', '12:00:00', { Location: 'GARKI ABUJA' }),
        ],
      },
      'W41',
      OBSERVED_AT
    );
    expect(
      result.events.filter(
        (e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS
      )
    ).toHaveLength(1);
  });
});

describe('bugfix: same-city districts and Nigeria-bound foreign-office scans', () => {
  it('does not infer an arrival from a district centre in a same-city shipment', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W45',
        Destination: 'ABUJA',
        Origin: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSVC', '09:00:00', { Location: 'GARKI' }),
          event('MSVC', '11:00:00', { Location: 'WUSE ABUJA' }),
        ],
      },
      'W45',
      OBSERVED_AT
    );
    expect(
      result.events.some((e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS)
    ).toBe(false);
  });

  it('keeps a Nigeria-bound ARFK scan recognized as in_transit without an arrival', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W46',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [event('ARFK', '09:00:00')],
      },
      'W46',
      OBSERVED_AT
    );
    expect(result.hasRecognizedLifecycleEvent).toBe(true);
    expect(result.status).toBe('in_transit');
    expect(result.events[0]?.rawStatus).toBe('ARFK');
  });
});
