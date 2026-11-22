import { expect, it } from 'vitest';
import { hasBankCardOfferReferencePrefix } from './has-bank-card-offer-reference-prefix';

it.each([
  `BCO-${'a'.repeat(32)}`,
  `BCO-${'A'.repeat(32)}`,
  `bco-${'a'.repeat(32)}`,
  'BCO-invalid',
])('reserves the namespace for %s so the reference cannot fall through', (reference) =>
  expect(hasBankCardOfferReferencePrefix(reference)).toBe(true));

it.each([
  'PAYSTACK-A',
  null,
  undefined,
])('does not reserve the prefix for %s', (reference) => {
  expect(hasBankCardOfferReferencePrefix(reference)).toBe(false);
});
