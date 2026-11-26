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
    expect(result.status).toBe('picked_up');
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

describe('bugfix: a stale MSHC after delivery is not rewritten to pickup', () => {
  it('keeps the MSHC event out of the pickup states once delivered', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W27',
        MobileShipmentTrackings: [
          event('SHD', '11:00:00'),
          event('MSHC', '11:00:00'),
        ],
      },
      'W27',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
    expect(result.events.find((e) => e.rawStatus === 'MSHC')?.status).not.toBe(
      'pickup_scheduled'
    );
  });
});

describe('bugfix: same-time pickup assignment and shipment creation keep payload order', () => {
  it('keeps pickup_scheduled when MAPT is listed before MCRT at the same time', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W29',
        MobileShipmentTrackings: [
          event('MAPT', '10:00:00'),
          event('MCRT', '10:00:00'),
        ],
      },
      'W29',
      OBSERVED_AT
    );
    expect(result.status).toBe('pickup_scheduled');
  });

  it.each([
    ['MSHC before MCRT', ['MSHC', 'MCRT']],
    ['MCRT before MSHC', ['MCRT', 'MSHC']],
  ])('bugfix: pickup-run MSHC beats a same-time MCRT creation scan (%s)', (_label, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W30',
        MobileShipmentTrackings: order.map((code) => event(code, '10:00:00')),
      },
      'W30',
      OBSERVED_AT
    );
    expect(result.status).toBe('pickup_scheduled');
  });
});
