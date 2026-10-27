import { expect, it } from 'vitest';
import { CART_ERROR_CODES, isCartErrorCode } from './error-codes';

it.each(CART_ERROR_CODES)('recognizes the supported %s outcome', (code) => {
  expect(isCartErrorCode(code)).toBe(true);
});
it.each([
  undefined,
  null,
  {},
  403,
  'unexpected_provider_error',
])('rejects unsupported JSON error values (%s)', (code) => {
  expect(isCartErrorCode(code)).toBe(false);
});
