import { expect, it } from 'vitest';
import { parseBankOfferRefundableKobo } from './parse-bank-offer-refundable-kobo';

it.each([
  1,
  9501,
  Number.MAX_SAFE_INTEGER,
])('accepts exact number and text kobo %s', (amount) => {
  expect(parseBankOfferRefundableKobo(amount)).toBe(amount);
  expect(parseBankOfferRefundableKobo(String(amount))).toBe(amount);
});

it.each([
  null,
  true,
  0,
  -1,
  1.5,
  '0',
  '1.5',
  '1e3',
  ' 9501 ',
  '9007199254740992',
])('rejects invalid or unsafe refund evidence %j', (value) =>
  expect(parseBankOfferRefundableKobo(value)).toBeNull());
