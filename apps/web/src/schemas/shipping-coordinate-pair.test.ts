import { describe, expect, it } from 'vitest';
import { shippingCoordinatePairSchema } from './shipping-coordinate-pair';

describe('shipping coordinate pair', () => {
  it.each([
    {},
    { latitude: -90, longitude: -180 },
    { latitude: 90, longitude: 180 },
  ])('accepts absent pins and inclusive coordinate boundaries %j', (pin) => {
    expect(shippingCoordinatePairSchema.parse(pin)).toEqual(pin);
  });

  it.each([
    { latitude: 0 },
    { longitude: 0 },
    { latitude: -90.01, longitude: 0 },
    { latitude: 0, longitude: 180.01 },
    { latitude: 0, longitude: null },
  ])('rejects malformed pair %j', (pin) => {
    expect(shippingCoordinatePairSchema.safeParse(pin).success).toBe(false);
  });
});
