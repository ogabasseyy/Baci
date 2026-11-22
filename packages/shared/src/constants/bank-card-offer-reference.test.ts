import { expect, it } from 'vitest';
import { BANK_CARD_OFFER_REFERENCE_PATTERN } from './bank-card-offer-reference';

it('accepts the exact stored reference', () => {
  expect(BANK_CARD_OFFER_REFERENCE_PATTERN.test(`BCO-${'a'.repeat(32)}`)).toBe(
    true
  );
});

it.each([
  `BCO-${'A'.repeat(32)}`,
  `bco-${'a'.repeat(32)}`,
  'BCO-invalid',
])('rejects the malformed reference %s', (reference) =>
  expect(BANK_CARD_OFFER_REFERENCE_PATTERN.test(reference)).toBe(false));
