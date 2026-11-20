import { expect, it } from 'vitest';
import {
  bankCardOfferReferenceSchema,
  bankCardOfferTerminalStatusSchema,
} from './bank-card-offer-reference';

it('accepts only a complete lowercase bank-offer reference', () => {
  expect(
    bankCardOfferReferenceSchema.safeParse(`BCO-${'a'.repeat(32)}`).success
  ).toBe(true);
  expect(
    bankCardOfferReferenceSchema.safeParse(`BCO-${'A'.repeat(32)}`).success
  ).toBe(false);
  expect(bankCardOfferReferenceSchema.safeParse('BCO-123').success).toBe(false);
});

it.each([
  'failed',
  'abandoned',
  'cancelled',
  'reversed',
])('accepts the confirmed terminal status %s', (status) => {
  expect(bankCardOfferTerminalStatusSchema.parse(status)).toBe(status);
});

it.each([
  'pending',
  'success',
  undefined,
])('excludes a non-terminal status %s', (status) => {
  expect(bankCardOfferTerminalStatusSchema.safeParse(status).success).toBe(
    false
  );
});
