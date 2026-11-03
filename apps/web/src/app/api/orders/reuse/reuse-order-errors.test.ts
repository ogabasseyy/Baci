import { expect, it } from 'vitest';
import {
  getSafeReuseOrderErrorMessage,
  isExpectedReuseOrderError,
  mapReuseOrderError,
} from './reuse-order-errors';

it('maps the Oxygen fence and keeps unexpected errors sanitized in diagnostics', () => {
  expect(
    mapReuseOrderError({ message: 'oxygen_payment_in_progress' })
  ).toMatchObject({ status: 409, code: 'oxygen_payment_in_progress' });
  expect(
    isExpectedReuseOrderError({ message: 'oxygen_payment_in_progress' })
  ).toBe(true);
  expect(isExpectedReuseOrderError({ message: 'unexpected' })).toBe(false);
  expect(
    getSafeReuseOrderErrorMessage({
      message: 'failure https://example.test/secret',
    })
  ).toBe('failure [url]');
});
