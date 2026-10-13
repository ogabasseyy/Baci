import { describe, expect, it } from 'vitest';
import { shippingCheckoutRecoverySchema } from './shipping-checkout-recovery';

const receiver = {
  address: '12 Test Street',
  city: 'Ikeja',
  state: 'Lagos',
  phone: '08000000000',
  latitude: 0,
  longitude: 0,
};
describe('checkout recovery input', () => {
  it('accepts an explicit zero pin', () => {
    expect(
      shippingCheckoutRecoverySchema.parse({ action: 'preview', receiver })
    ).toEqual({ action: 'preview', receiver });
  });
  it.each([
    { latitude: undefined },
    { longitude: undefined },
    { latitude: 91 },
    { longitude: -181 },
    { latitude: Number.NaN },
    { longitude: '3.3' },
    { address: '' },
  ])('rejects incomplete or invalid destination %j', (change) => {
    expect(
      shippingCheckoutRecoverySchema.safeParse({
        action: 'preview',
        receiver: { ...receiver, ...change },
      }).success
    ).toBe(false);
  });
  it('requires true confirmation and rejects caller-controlled pricing', () => {
    expect(
      shippingCheckoutRecoverySchema.safeParse({
        action: 'confirm',
        previewId: '70000000-0000-4000-8000-000000000001',
        confirmDestination: false,
      }).success
    ).toBe(false);
    expect(
      shippingCheckoutRecoverySchema.safeParse({
        action: 'preview',
        receiver,
        price: 110,
      }).success
    ).toBe(false);
  });
});
