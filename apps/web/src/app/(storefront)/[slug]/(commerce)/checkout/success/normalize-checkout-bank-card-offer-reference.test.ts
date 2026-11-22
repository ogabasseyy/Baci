import { expect, it } from 'vitest';
import { normalizeCheckoutBankCardOfferReference } from './normalize-checkout-bank-card-offer-reference';

it('normalizes only the reserved bank offer reference format', () => {
  expect(normalizeCheckoutBankCardOfferReference(`bco-${'A'.repeat(32)}`)).toBe(
    `BCO-${'a'.repeat(32)}`
  );
  expect(
    normalizeCheckoutBankCardOfferReference(`PSK-${'A'.repeat(32)}`)
  ).toBeNull();
  expect(normalizeCheckoutBankCardOfferReference('BCO-invalid')).toBeNull();
  expect(normalizeCheckoutBankCardOfferReference(null)).toBeNull();
});
