import { expect, it } from 'vitest';
import { buildCheckoutBillingAddress } from './build-checkout-billing-address';
it('retains the merchant country for non-Nigerian checkout', () => {
  const address = buildCheckoutBillingAddress('12 Marine Drive', 'Mumbai', 'Maharashtra', 'IN');
  expect(address).toMatchObject({ country: 'IN', city: 'Mumbai', state: 'Maharashtra' });
  expect(address.zip_code).toBeUndefined();
});
it('preserves the existing city and state fallbacks', () => {
  const address = buildCheckoutBillingAddress('1 Road', '', '', 'NG');
  expect(address).toMatchObject({ country: 'NG', city: 'Lagos', state: 'Lagos' });
});
