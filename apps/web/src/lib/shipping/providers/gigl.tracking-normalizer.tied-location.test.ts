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
});
