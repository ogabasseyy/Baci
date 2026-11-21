import { expect, it } from 'vitest';
import {
  paystackTerminalCustomerSchema,
  paystackVerifyResponseSchema,
} from './paystack-card-offer-verification';

const data = {
  amount: 9500,
  authorization: { bank: 'Sterling Bank', brand: 'visa', channel: 'card' },
  channel: 'card',
  currency: 'NGN',
  customer: { email: 'customer@example.test' },
  domain: 'test',
  id: '9007199254740993',
  paid_at: '2026-11-27T12:02:00Z',
  reference: 'checkout-reference',
  status: 'success',
};

it('parses a successful capture without rounding the provider ID', () => {
  expect(paystackVerifyResponseSchema.parse({ status: true, data })).toEqual({
    status: true,
    data,
  });
});

it.each([
  { status: 'reversed' },
  { amount: 0 },
  { amount: 1.5 },
  { customer: { email: 'invalid' } },
  { id: '' },
  { paid_at: '2026-11-27' },
])('rejects incomplete or unsuccessful capture evidence (%j)', (change) => {
  expect(
    paystackVerifyResponseSchema.safeParse({
      status: true,
      data: { ...data, ...change },
    }).success
  ).toBe(false);
});

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
