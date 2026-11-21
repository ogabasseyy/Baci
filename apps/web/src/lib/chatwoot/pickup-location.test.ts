import { describe, expect, it } from 'vitest';
import { formatChatwootPickupLocation } from './pickup-location';

describe('formatChatwootPickupLocation', () => {
  it('joins station name and address for a pickup rate', () => {
    expect(
      formatChatwootPickupLocation({
        isStationPickup: true,
        stationName: 'Ikeja Shop',
        stationAddress: '1 Allen Avenue',
      })
    ).toBe('Ikeja Shop · 1 Allen Avenue');
  });

  it('uses whichever part exists and trims', () => {
    expect(
      formatChatwootPickupLocation({
        isStationPickup: true,
        stationName: '  Shop  ',
      })
    ).toBe('Shop');
  });

  it('cuts to 240 characters', () => {
    const result = formatChatwootPickupLocation({
      isStationPickup: true,
      stationName: 'a'.repeat(300),
    });
    expect(result).toHaveLength(240);
  });

  it('is undefined for a door rate or an empty location', () => {
    expect(
      formatChatwootPickupLocation({ stationName: 'Shop' })
    ).toBeUndefined();
    expect(
      formatChatwootPickupLocation({ isStationPickup: true, stationName: ' ' })
    ).toBeUndefined();
    expect(
      formatChatwootPickupLocation({ isStationPickup: true })
    ).toBeUndefined();
  });
});
