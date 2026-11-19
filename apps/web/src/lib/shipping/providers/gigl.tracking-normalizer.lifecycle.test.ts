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
  it('keeps out_for_delivery for a failed attempt followed by MSHC with no earlier transit scans', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W13',
        MobileShipmentTrackings: [
          event('FAILED', '10:00:00'),
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
    expect(result.status).toBe('picked_up');
    expect(result.events.some((e) => e.status === 'out_for_delivery')).toBe(
      false
    );
    expect(result.events.find((e) => e.rawStatus === 'MSHC')?.status).toBe(
      'picked_up'
    );
  });
});

describe('bugfix: unknown origin does not turn the first hub scan into arrival', () => {
  it('does not flag a first destination-named scan when Origin is missing', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W24',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSVC', '10:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
        ],
      },
      'W24',
      OBSERVED_AT
    );
    expect(
      result.events.some((e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS)
    ).toBe(false);
  });

  it('still flags arrival when Origin is missing but the parcel moved away first', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W25',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSVC', '09:00:00', { Location: 'IKEJA LAGOS (Ikeja)' }),
          event('MSVC', '11:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
        ],
      },
      'W25',
      OBSERVED_AT
    );
    expect(
      result.events.some((e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS)
    ).toBe(true);
  });
});

describe('bugfix: a scan without a location does not prove the parcel left the destination centre', () => {
  it('does not flag arrival for a repeat origin scan after a location-less hub scan (same city)', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W26',
        Origin: 'ABUJA',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('MSVC', '10:00:00'),
          event('MSVC', '11:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
        ],
      },
      'W26',
      OBSERVED_AT
    );
    expect(
      result.events.some((e) => e.rawStatus === GIGL_ARRIVED_IN_CITY_RAW_STATUS)
    ).toBe(false);
  });
});

describe('bugfix: pickup-reason MSHC after completed pickup keeps the provider raw status', () => {
  it('does not leave the pickup-en-route raw status on an MSHC that follows MPIK', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W28',
        MobileShipmentTrackings: [
          event('MPIK', '10:00:00'),
          event('MSHC', '11:00:00', {
            ScanStatusReason: 'RIDER EN ROUTE FOR PICKUP',
          }),
        ],
      },
      'W28',
      OBSERVED_AT
    );
    const mshc = result.events.find((e) => e.rawStatus === 'MSHC');
    expect(mshc?.status).toBe('picked_up');
    expect(
      result.events.some((e) => e.rawStatus === 'RIDER EN ROUTE FOR PICKUP')
    ).toBe(false);
  });
});
