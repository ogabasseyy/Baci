import { expect, it } from 'vitest';
import {
  isOxygenPaymentOriginError,
  OxygenPaymentOriginUnverifiedError,
  oxygenPaymentOriginMessage,
} from './payment-origin-error';

it('matches only the exact payment-origin constraint failure', () => {
  expect(
    isOxygenPaymentOriginError({
      code: '23514',
      message: 'oxygen_payment_origin_unverified',
    })
  ).toBe(true);
  expect(
    isOxygenPaymentOriginError({
      code: '23514',
      message: 'different_constraint',
    })
  ).toBe(false);
  expect(
    isOxygenPaymentOriginError({
      code: '42501',
      message: 'oxygen_payment_origin_unverified',
    })
  ).toBe(false);
  expect(isOxygenPaymentOriginError({})).toBe(false);
});

it('presents static support guidance without database details', () => {
  const error = new OxygenPaymentOriginUnverifiedError();
  expect(error.name).toBe('OxygenPaymentOriginUnverifiedError');
  expect(error.message).toBe(oxygenPaymentOriginMessage);
  expect(error.message).not.toContain('oxygen_payment_origin_unverified');
});
