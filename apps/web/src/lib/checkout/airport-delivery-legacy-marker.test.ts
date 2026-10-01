import { describe, expect, it } from 'vitest';
import { getLegacyAirportType } from '@/lib/checkout/airport-delivery-legacy-marker';

describe('getLegacyAirportType', () => {
  it('recognizes exact legacy airport markers case-insensitively', () => {
    expect(getLegacyAirportType(' Airport Pickup ')).toBe('pickup');
    expect(getLegacyAirportType('Airport Delivery')).toBe('delivery');
    expect(getLegacyAirportType('Airport Delivery (Outside Lagos)')).toBe(
      'delivery'
    );
  });

  it('does not classify ordinary addresses as airport markers', () => {
    expect(getLegacyAirportType('12 Airport Road')).toBeNull();
    expect(getLegacyAirportType(null)).toBeNull();
    expect(getLegacyAirportType(undefined)).toBeNull();
  });
});
