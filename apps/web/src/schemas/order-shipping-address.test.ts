import { describe, expect, it } from 'vitest';
import { orderShippingAddressSchema } from './order-shipping-address';

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
});
