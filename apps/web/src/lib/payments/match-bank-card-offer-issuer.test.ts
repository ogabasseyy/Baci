import { expect, it } from 'vitest';
import { matchBankCardOfferIssuer } from './match-bank-card-offer-issuer';

it.each([
  ['035', 'Wema Bank', ' WEMA  BANK PLC. ', true],
  ['035', 'Wema Bank', 'Wema Bank Ltd', true],
  ['035', 'Wema Bank', 'Wema Bank Limited', true],
  ['232', 'Sterling Bank', 'Sterling Bank Limited', true],
  ['232', 'Sterling Bank', 'Sterling Bank Plc', true],
  ['232', 'Sterling Bank', ' Sterling Bank Ltd. ', true],
  ['232', 'Sterling Bank', 'Sterling Bank', true],
  ['035', 'Wema Bank', 'Sterling Bank Plc', false],
  ['232', 'Sterling Bank', 'Wema Bank Limited', false],
  ['035', 'Sterling Bank', 'Sterling Bank', false],
  ['232', 'Sterling Bank', 'Sterling Bank UK Limited', false],
  ['232', 'Sterling Bank', '', false],
] as const)('checks %s saved label %j with provider label %j', (bankCode, saved, provider, accepted) => {
  expect(matchBankCardOfferIssuer(bankCode, saved, provider)).toBe(accepted);
});

it.each([
  '999',
  '__proto__',
  'constructor',
])('rejects the unsupported bank code %s', (code) => {
  expect(matchBankCardOfferIssuer(code, 'Wema Bank', 'Wema Bank')).toBe(false);
});
