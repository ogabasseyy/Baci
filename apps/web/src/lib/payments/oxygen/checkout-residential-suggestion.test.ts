import { expect, it } from 'vitest';
import { checkoutResidentialSuggestion } from './checkout-residential-suggestion';

it.each([
  'pickup',
  'pickup_station',
  'airport',
  null,
])('never suggests a pickup or unknown address for %s', (mode) => {
  expect(
    checkoutResidentialSuggestion(mode, {
      address: 'Ogabassey Ikeja office',
      state: 'Lagos',
    })
  ).toEqual({});
});
it('suggests an editable door-delivery address without copying unrelated order data', () => {
  expect(
    checkoutResidentialSuggestion('door', {
      address: 'Example Road',
      city: 'Ikeja',
      phone: 'private',
      country: 'Nigeria',
    })
  ).toEqual({
    street: 'Example Road',
    city: 'Ikeja',
    state: '',
    lga: '',
    landmark: '',
    house_number: '',
  });
});
