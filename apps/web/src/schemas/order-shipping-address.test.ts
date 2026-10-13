import { describe, expect, it } from 'vitest';
import {
  orderShippingAddressSchema,
  shippingCoordinatePairSchema,
} from './order-shipping-address';

describe('order shipping address', () => {
  it('keeps text sanitization and strips unknown keys', () => {
    expect(
      orderShippingAddressSchema.parse({
        address: '<script>x</script>12 Test Street',
        city: 'Ikeja',
        phone: 'untrusted',
        latitude: 0,
        longitude: 0,
      })
    ).toEqual({
      address: 'x12 Test Street',
      city: 'Ikeja',
      latitude: 0,
      longitude: 0,
    });
  });

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
