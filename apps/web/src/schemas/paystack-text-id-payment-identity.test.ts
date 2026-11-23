import { expect, it } from 'vitest';
import { paystackTextIdPaymentIdentitySchema } from './paystack-text-id-payment-identity';

const identity = {
  currency: 'NGN',
  id: '9007199254740993',
  reference: 'REF-1',
  status: 'reversed',
};

it('accepts an exact decimal identity without capture-only fields', () => {
  expect(paystackTextIdPaymentIdentitySchema.parse(identity)).toEqual(identity);
});

it.each([
  { id: 5 },
  { id: '0' },
  { id: '0009' },
  { reference: '' },
  { currency: '' },
  { status: undefined },
])('rejects an invalid provider identity override %j', (override) => {
  expect(
    paystackTextIdPaymentIdentitySchema.safeParse({ ...identity, ...override })
      .success
  ).toBe(false);
});
