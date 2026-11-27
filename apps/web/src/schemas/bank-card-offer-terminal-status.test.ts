import { expect, it } from 'vitest';
import { bankCardOfferTerminalStatusSchema } from './bank-card-offer-terminal-status';

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
