import { afterEach, expect, it } from 'vitest';
import { bankOfferCheckoutReferenceStorage } from './bank-offer-checkout-reference-storage';

afterEach(() => window.sessionStorage.clear());

it('recovers a canonical gateway reference only for its saved merchant and order', () => {
  const reference = `BCO-${'a'.repeat(32)}`;
  bankOfferCheckoutReferenceStorage.write('merchant', 'existing-order', reference);
  expect(bankOfferCheckoutReferenceStorage.read('merchant', 'existing-order')).toBe(reference);
  expect(bankOfferCheckoutReferenceStorage.read('another-merchant', 'existing-order')).toBeNull();
  expect(bankOfferCheckoutReferenceStorage.read('merchant', 'another-order')).toBeNull();
  expect(() => bankOfferCheckoutReferenceStorage.write('merchant', 'existing-order', 'bco-invalid'))
    .toThrow('Invalid bank card offer payment reference');
});
