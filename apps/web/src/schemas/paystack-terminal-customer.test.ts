import { expect, it } from 'vitest';
import { paystackTerminalCustomerSchema } from './paystack-terminal-customer';

it('trims buyer email on terminal evidence and rejects malformed addresses', () => {
  expect(
    paystackTerminalCustomerSchema.parse({
      customer: { email: ' customer@example.test ' },
    })
  ).toEqual({ customer: { email: 'customer@example.test' } });
  expect(
    paystackTerminalCustomerSchema.safeParse({
      customer: { email: '   ' },
    }).success
  ).toBe(false);
});
