import { describe, expect, it } from 'vitest';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

const OBSERVED_AT = new Date('2026-11-10T00:00:00.000Z');

function event(
  status: string,
  time: string,
  extra: Record<string, string> = {}
) {
  return { Status: status, DateTimeUtc: `2026-11-09T${time}.000Z`, ...extra };
}

describe('bugfix: first-poll precedence across terminal outcomes and the snapshot event', () => {
  it('reports cancelled (not delivered) for an older cancellation followed by a newer delivery', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W70',
        MobileShipmentTrackings: [
          event('MSCP', '10:00:00'),
          event('SHD', '11:00:00'),
        ],
      },
      'W70',
      OBSERVED_AT
    );
    expect(result.status).toBe('cancelled');
    expect(result.actualDelivery).toBeUndefined();
  });

  it("keeps a tied failed scan's own location instead of the arrival centre", () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W71',
        Origin: 'LAGOS',
        Destination: 'ABUJA',
        MobileShipmentTrackings: [
          event('DPC', '10:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
          event('ARF', '12:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
          event('DELIVERY_FAILED', '12:00:00', {
            Location: 'MAITAMA (Customer address)',
          }),
        ],
      },
      'W71',
      OBSERVED_AT
    );
    expect(result.status).toBe('failed');
    expect(result.events[0]?.location).toContain('MAITAMA');
  });

  it('leads with the SDR so a newer progress scan does not set the snapshot location', () => {
    const result = normalizeGiglTrackingShipment(
      {
        Waybill: 'W72',
        MobileShipmentTrackings: [
          event('SDR', '10:00:00', { Location: 'IKEJA 2 (IKEJA)' }),
          event('MSVC', '12:00:00', { Location: 'WUSE ABUJA (Wuse)' }),
        ],
      },
      'W72',
      OBSERVED_AT
    );
    expect(result.status).toBe('failed');
    expect(result.events[0]?.location).toContain('IKEJA 2');
  });
});
