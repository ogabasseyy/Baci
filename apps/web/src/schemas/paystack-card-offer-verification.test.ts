import { expect, it } from 'vitest';
import { paystackVerifyResponseSchema } from './paystack-card-offer-verification';

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
