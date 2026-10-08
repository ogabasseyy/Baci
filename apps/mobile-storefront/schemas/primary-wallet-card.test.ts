import { expect, it } from '@jest/globals';
import { primaryWalletCardSchemas as schemas } from './primary-wallet-card';

const operationId = '22222222-2222-4222-8222-222222222222';
const response = {
  operationId,
  amountKobo: 100000,
  currency: 'NGN',
  reference: `pvb-first-primary-${operationId}`,
  status: 'custody_pending',
};
it('accepts pending custody without inventing checkout URLs or wallet credit', () => {
  expect(schemas.response.parse(response)).toEqual(response);
  expect(
    schemas.response.safeParse({ ...response, status: 'successful' }).success
  ).toBe(false);
});
it('requires exact operation/reference correlation and a provider-selected ready checkout', () => {
  expect(
    schemas.response.safeParse({ ...response, reference: 'foreign' }).success
  ).toBe(false);
  expect(
    schemas.response.safeParse({ ...response, status: 'ready' }).success
  ).toBe(false);
  expect(
    schemas.response.safeParse({
      ...response,
      status: 'ready',
      authorizationUrl: 'https://caller.example.com',
    }).success
  ).toBe(false);
});
it('requires explicit versioned financial consent and rejects arbitrary metadata', () => {
  expect(
    schemas.consent.safeParse({
      version: 'primary-wallet-card-v1',
      oneTimeCharge: true,
      saveCard: false,
    }).success
  ).toBe(true);
  expect(
    schemas.consent.safeParse({
      version: 'primary-wallet-card-v1',
      oneTimeCharge: true,
    }).success
  ).toBe(false);
  expect(
    schemas.consent.safeParse({
      version: 'primary-wallet-card-v1',
      oneTimeCharge: false,
      saveCard: false,
    }).success
  ).toBe(false);
});
