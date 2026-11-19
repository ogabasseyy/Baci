import { expect, it } from 'vitest';
import { failureOf } from './shared-cart-client-support';

it('preserves CSRF-style forbidden errors as non-adopting failures', () => {
  expect(failureOf({ code: 'forbidden' }, 403)).toEqual({
    code: 'forbidden',
    ok: false,
    retryable: false,
    snapshot: null,
  });
});

it('preserves the explicit proof-scope rejection sent by the create route', () => {
  expect(failureOf({ code: 'unauthorized' }, 401).code).toBe('unauthorized');
});

it.each([
  undefined,
  null,
  {},
  403,
  'unexpected_provider_error',
])('falls back for unsupported response codes (%s)', (code) => {
  expect(failureOf({ code }, 400, 'invalid_item').code).toBe('invalid_item');
});

it.each([
  ['missing_proof', 'unauthorized'],
  ['invalid_proof', 'unauthorized'],
  ['expired_proof', 'unauthorized'],
  ['merchant_unresolved', 'merchant_unavailable'],
  ['merchant_mismatch', 'merchant_unavailable'],
  ['invalid_request', 'invalid_item'],
  ['quota_exceeded', 'rate_limited'],
])('maps the supported transport code %s to %s', (input, expected) => {
  expect(failureOf({ code: input }, 400).code).toBe(expected);
});

it('normalizes quota bodies to the retryable canonical rate-limit code', () => {
  expect(failureOf({ code: 'quota_exceeded' }, 429)).toMatchObject({
    code: 'rate_limited',
    retryable: true,
  });
});
