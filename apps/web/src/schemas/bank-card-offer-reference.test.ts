import { expect, it } from 'vitest';
import { bankCardOfferReferenceSchema } from './bank-card-offer-reference';

it('accepts only a complete lowercase bank-offer reference', () => {
  expect(
    bankCardOfferReferenceSchema.safeParse(`BCO-${'a'.repeat(32)}`).success
  ).toBe(true);
  expect(
    bankCardOfferReferenceSchema.safeParse(`BCO-${'A'.repeat(32)}`).success
  ).toBe(false);
  expect(bankCardOfferReferenceSchema.safeParse('BCO-123').success).toBe(false);
});
