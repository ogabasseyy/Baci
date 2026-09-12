import { expect, it } from 'vitest';
import { canShowDeliveryMethods } from './can-show-delivery-methods';
import { isCheckoutDeliveryAddressReady } from './is-checkout-delivery-address-ready';

it('offers pickup for Ikeja, Lagos without enabling streetless door quotes', () => {
  const location = { city: 'Ikeja', state: 'Lagos' };
  expect(canShowDeliveryMethods({ ...location, isHydrated: true, isNewAddressMode: true, selectedAddressId: null })).toBe(true);
  expect(isCheckoutDeliveryAddressReady({ ...location, address: 'Ikeja, Lagos', country: 'Nigeria' })).toBe(false);
});
it('waits for hydration and a complete location or selected saved address', () => {
  const input = { city: 'Ikeja', state: 'Lagos', isHydrated: true, isNewAddressMode: true, selectedAddressId: null };
  expect(canShowDeliveryMethods({ ...input, isHydrated: false })).toBe(false);
  expect(canShowDeliveryMethods({ ...input, state: ' ' })).toBe(false);
  expect(canShowDeliveryMethods({ ...input, isNewAddressMode: false })).toBe(false);
  expect(canShowDeliveryMethods({ ...input, isNewAddressMode: false, selectedAddressId: 1 })).toBe(true);
});
