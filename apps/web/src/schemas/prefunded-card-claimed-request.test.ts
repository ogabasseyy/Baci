import { expect, it } from 'vitest';
import { prefundedCardClaimedRequestSchema as schema } from './prefunded-card-claimed-request';

const identifier = '10000000-0000-4000-8000-000000000001';
const request = {
  operationId: identifier,
  integrationId: identifier,
  merchantId: identifier,
  customerId: identifier,
  goalId: identifier,
  treasuryBindingId: identifier,
  businessId: 'business',
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  destinationCustomerId: 'provider-customer',
  amountKobo: 100,
  currency: 'NGN',
  collectionReference: 'collection',
  transferReference: 'transfer',
  savedMethodId: identifier,
};

it('accepts the complete scoped immutable provider request', () => {
  expect(schema.parse(request)).toEqual(request);
});

it.each([
  { sourceWalletId: 'destination' },
  { transferReference: 'collection' },
  { businessId: '' },
  { businessId: ' business' },
  { destinationWalletId: 'wallet\n' },
  { merchantId: 'unscoped' },
  { amountKobo: 0.5 },
  { amountKobo: Number.MAX_SAFE_INTEGER + 1 },
  { sourceWalletId: undefined },
  { currency: 'USD' },
  { authorizationCode: 'should-not-be-in-claim' },
])('rejects an invalid request without normalizing away authority: %j', (change) => {
  expect(schema.safeParse({ ...request, ...change }).success).toBe(false);
});
