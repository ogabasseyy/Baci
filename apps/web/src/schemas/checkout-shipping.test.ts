import { describe, expect, it } from 'vitest';
import { checkoutShippingSchema } from './checkout-shipping';

const address = {
  firstName: 'Test',
  lastName: 'Buyer',
  email: 'fixture@example.test',
  phone: '+2348031234567',
  address: '12 Broad Street',
  city: 'Lagos Island',
  state: 'Lagos',
};
describe('shared checkout destination', () => {
  it('accepts manual entry and a selected coordinate pair', () => {
    expect(checkoutShippingSchema.safeParse(address).success).toBe(true);
    expect(
      checkoutShippingSchema.parse({
        ...address,
        latitude: 6.454,
        longitude: 3.393,
      })
    ).toMatchObject({ latitude: 6.454, longitude: 3.393 });
    expect(
      checkoutShippingSchema.safeParse({
        ...address,
        latitude: null,
        longitude: null,
      }).success
    ).toBe(true);
  });
  it.each([
    { latitude: 91 },
    { longitude: -181 },
    { latitude: Number.NaN },
    { longitude: '3.393' },
  ])('rejects invalid coordinates %j', (pin) => {
    expect(
      checkoutShippingSchema.safeParse({ ...address, ...pin }).success
    ).toBe(false);
  });
  it.each(['address', 'city', 'state'])('requires explicit %s', (field) => {
    expect(
      checkoutShippingSchema.safeParse({ ...address, [field]: '' }).success
    ).toBe(false);
  });
});
