import { describe, expect, it } from 'vitest';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

const OBSERVED_AT = new Date('2026-11-10T00:00:00.000Z');

describe('bugfix: a tied arrival scan owns the snapshot location even when the leader is located', () => {
  it('uses the arrival centre, not the MSHC hub, when both scans carry a location', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W60',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          {
            Status: 'DPC',
            DateTimeUtc: '2026-11-09T10:00:00.000Z',
            Location: 'IKEJA 2 (IKEJA)',
          },
          {
            Status: 'MSHC',
            DateTimeUtc: '2026-11-09T12:00:00.000Z',
            Location: 'GWAGWALADA (Abuja Road)',
          },
          {
            Status: 'ARF',
            DateTimeUtc: '2026-11-09T12:00:00.000Z',
            Location: 'WUSE ABUJA (Wuse)',
          },
        ],
      },
      'W60',
      OBSERVED_AT
    );
    expect(result.events[0]?.location).toContain('WUSE ABUJA');
  });

  it("keeps a located terminal scan's own location when an arrival is tied with it", () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W61',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          {
            Status: 'DPC',
            DateTimeUtc: '2026-11-09T10:00:00.000Z',
            Location: 'IKEJA 2 (IKEJA)',
          },
          {
            Status: 'ARF',
            DateTimeUtc: '2026-11-09T12:00:00.000Z',
            Location: 'WUSE ABUJA (Wuse)',
          },
          {
            Status: 'SHD',
            DateTimeUtc: '2026-11-09T12:00:00.000Z',
            Location: 'MAITAMA (Customer address)',
          },
        ],
      },
      'W61',
      OBSERVED_AT
    );
    expect(result.status).toBe('delivered');
    expect(result.events[0]?.location).toContain('MAITAMA');
  });

  it('gives the same snapshot location whether or not an unrelated later scan is added', () => {
    const base = [
      {
        Status: 'DPC',
        DateTimeUtc: '2026-11-09T10:00:00.000Z',
        Location: 'IKEJA 2 (IKEJA)',
      },
      {
        Status: 'ARF',
        DateTimeUtc: '2026-11-09T11:00:00.000Z',
        Location: 'WUSE ABUJA (Wuse)',
      },
      { Status: 'SHD', DateTimeUtc: '2026-11-09T11:00:00.000Z' },
    ];
    const run = (extra: { Status: string; DateTimeUtc: string }[]) =>
      normalizeGiglTrackingShipment(
        {
          Waybill: 'W62',
          Origin: 'LAGOS',
          Destination: 'ABUJA',
          MobileShipmentTrackings: [...base, ...extra],
        },
        'W62',
        OBSERVED_AT
      ).events[0]?.location;
    const without = run([]);
    const withLater = run([
      { Status: 'MSVC', DateTimeUtc: '2026-11-09T12:00:00.000Z' },
    ]);
    // A tied delivered scan fences the arrival, so its hub location is not
    // copied onto the location-less delivered snapshot.
    expect(without).toBeUndefined();
    expect(withLater).toBe(without);
  });
});
