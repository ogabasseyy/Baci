import { expect, it } from 'vitest';
import { z } from 'zod';
import { isOxygenPaymentSurface } from './oxygen-payment-surface';

it.each([
  '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df',
  '6974E8CC-4E90-4CA9-B2CF-AA2ABAF461DF',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'not-an-order',
  '11111111-1111-1111-1111-111111111111',
  '6974e8cc-4e90-4ca9-12cf-aa2abaf461df',
  '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df/extra',
])('matches the payment page UUID contract for %s', (id) => {
  expect(isOxygenPaymentSurface(`/payments/oxygen/${id}`)).toBe(
    z.uuid().safeParse(id).success
  );
});
it.each([
  '/checkout',
  '/checkout/',
  '/shop/checkout',
  '/shop/checkout/',
])('only grants checkout %s with a valid order query', (path) => {
  expect(isOxygenPaymentSurface(path)).toBe(false);
  expect(
    isOxygenPaymentSurface(
      path,
      new URLSearchParams('oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df')
    )
  ).toBe(true);
});
it('permits the trailing slash for a valid payment order', () => {
  expect(
    isOxygenPaymentSurface(
      '/payments/oxygen/6974e8cc-4e90-4ca9-b2cf-aa2abaf461df/'
    )
  ).toBe(true);
});
it('does not grant policy for a differently cased route prefix', () => {
  expect(
    isOxygenPaymentSurface(
      '/PAYMENTS/oxygen/6974e8cc-4e90-4ca9-b2cf-aa2abaf461df'
    )
  ).toBe(false);
});
