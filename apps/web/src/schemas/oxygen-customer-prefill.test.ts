import { expect, it } from 'vitest';
import { oxygenCustomerPrefillSchema } from './oxygen-customer-prefill';

it('allows and trims only the safe customer profile subset', () => {
  expect(
    oxygenCustomerPrefillSchema.parse({
      first_name: ' Ada ',
      email: 'ada@example.test',
    })
  ).toEqual({ first_name: 'Ada', email: 'ada@example.test' });
  expect(
    oxygenCustomerPrefillSchema.safeParse({
      first_name: 'Ada',
      bvn: '12345678901',
    }).success
  ).toBe(false);
  expect(
    oxygenCustomerPrefillSchema.safeParse({ email: 'invalid' }).success
  ).toBe(false);
});
