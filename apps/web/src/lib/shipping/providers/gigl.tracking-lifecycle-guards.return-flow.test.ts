import { describe, expect, it } from 'vitest';
import { GIGL_ARRIVED_IN_CITY_RAW_STATUS } from '../gigl-tracking-notification-policy-matrix';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

const OBSERVED_AT = new Date('2026-11-10T00:00:00.000Z');

describe('bugfix: no arrival promotion once the return flow has begun', () => {
  it.each([
    'MRTE',
    'SRC',
    'SSR',
    'RSR',
    'SRHUB',
    'VFSSRR',
  ])('does not rewrite an ARF that follows a %s return scan', (returnCode) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W80',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          {
            Status: 'DPC',
            DateTimeUtc: '2026-11-09T10:00:00.000Z',
            Location: 'IKEJA 2 (IKEJA)',
          },
          { Status: returnCode, DateTimeUtc: '2026-11-09T11:00:00.000Z' },
          {
            Status: 'ARF',
            DateTimeUtc: '2026-11-09T12:00:00.000Z',
            Location: 'IKEJA 2 (IKEJA)',
          },
        ],
      },
      'W80',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).not.toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it('still promotes an ARF when no return scan came before it', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W81',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          { Status: 'ARF', DateTimeUtc: '2026-11-09T12:00:00.000Z' },
        ],
      },
      'W81',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it.each([
    ['ARF listed first', ['ARF', 'MRTE']],
    ['return scan listed first', ['MRTE', 'ARF']],
  ])('bugfix: a tied return scan fences the arrival whatever the payload order (%s)', (_label, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W82',
        Destination: 'ABUJA',
        MobileShipmentTrackings: order.map((Status) => ({
          Status,
          DateTimeUtc: '2026-11-09T12:00:00.000Z',
        })),
      },
      'W82',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).not.toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it('bugfix: an MRTD (rerouted) scan does not fence a later destination arrival', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W83',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          { Status: 'MRTD', DateTimeUtc: '2026-11-09T11:00:00.000Z' },
          { Status: 'ARF', DateTimeUtc: '2026-11-09T12:00:00.000Z' },
        ],
      },
      'W83',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it('keeps an outbound arrival that came before the return began', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W84',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          { Status: 'ARF', DateTimeUtc: '2026-11-09T10:00:00.000Z' },
          { Status: 'SRHUB', DateTimeUtc: '2026-11-09T12:00:00.000Z' },
        ],
      },
      'W84',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it.each([
    ['ARF listed first', ['ARF', 'VFSSRR']],
    ['completed return listed first', ['VFSSRR', 'ARF']],
  ])('bugfix: a tied completed return (VFSSRR) fences the arrival whatever the payload order (%s)', (_label, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W85',
        Destination: 'ABUJA',
        MobileShipmentTrackings: order.map((Status) => ({
          Status,
          DateTimeUtc: '2026-11-09T12:00:00.000Z',
        })),
      },
      'W85',
      OBSERVED_AT
    );
    expect(result.events.map((e) => e.rawStatus)).not.toContain(
      GIGL_ARRIVED_IN_CITY_RAW_STATUS
    );
  });

  it.each([
    ['return scan first', ['MRTE', 'MSHC']],
    ['MSHC listed first (tied)', ['MSHC', 'MRTE']],
  ])('bugfix: an MSHC after the return began is not out-for-delivery (%s)', (_label, order) => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W86',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          {
            Status: 'DPC',
            DateTimeUtc: '2026-11-09T10:00:00.000Z',
            Location: 'IKEJA 2 (IKEJA)',
          },
          ...order.map((Status) => ({
            Status,
            DateTimeUtc: '2026-11-09T12:00:00.000Z',
          })),
        ],
      },
      'W86',
      OBSERVED_AT
    );
    expect(result.status).toBe('in_transit');
    expect(result.events.some((e) => e.status === 'out_for_delivery')).toBe(
      false
    );
  });
});
