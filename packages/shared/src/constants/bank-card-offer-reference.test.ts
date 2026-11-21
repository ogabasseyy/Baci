import { expect, it } from 'vitest';
import {
  BANK_CARD_OFFER_REFERENCE_PATTERN,
  hasBankCardOfferReferencePrefix,
} from './bank-card-offer-reference';

it('recognizes the exact stored reference', () => {
  const reference = `BCO-${'a'.repeat(32)}`;
  expect(hasBankCardOfferReferencePrefix(reference)).toBe(true);
  expect(BANK_CARD_OFFER_REFERENCE_PATTERN.test(reference)).toBe(true);
});

it.each([
  `BCO-${'A'.repeat(32)}`,
  `bco-${'a'.repeat(32)}`,
  'BCO-invalid',
])('reserves malformed reference %s so it cannot fall through to another gateway lane', (reference) => {
  expect(hasBankCardOfferReferencePrefix(reference)).toBe(true);
  expect(BANK_CARD_OFFER_REFERENCE_PATTERN.test(reference)).toBe(false);
});

it('leaves ordinary references outside the reserved prefix', () => {
  expect(hasBankCardOfferReferencePrefix('PAYSTACK-A')).toBe(false);
});
