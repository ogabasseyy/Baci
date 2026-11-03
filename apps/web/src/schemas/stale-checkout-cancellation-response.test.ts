import { expect, it } from 'vitest';
import { staleCheckoutCancellationResponseSchema } from './stale-checkout-cancellation-response';

it('requires an explicit successful cancellation result with a boolean outcome', () => {
  expect(
    staleCheckoutCancellationResponseSchema.safeParse({
      success: true,
      cancelled: false,
    }).success
  ).toBe(true);
  expect(
    staleCheckoutCancellationResponseSchema.safeParse({
      success: true,
      cancelled: 'true',
    }).success
  ).toBe(false);
  expect(
    staleCheckoutCancellationResponseSchema.safeParse({
      success: false,
      cancelled: true,
    }).success
  ).toBe(false);
});
