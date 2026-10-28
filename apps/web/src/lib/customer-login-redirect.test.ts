import { describe, expect, it } from 'vitest';
import { sanitizeRedirect } from './customer-login-redirect';

describe('sanitizeRedirect', () => {
  it.each([
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/%2f%2fevil.example',
    '/%5cevil.example',
    '/%252f%252fevil.example',
    '/%5Cevil.example',
  ])('rejects unsafe redirect %j', (input) => {
    expect(sanitizeRedirect(input)).toBe('/account');
  });
  it('preserves a local redirect', () =>
    expect(sanitizeRedirect('/imei-check')).toBe('/imei-check'));
});

it('keeps encoded query values on local paths', () => {
  expect(sanitizeRedirect('/imei-check?next=%2Faccount')).toBe(
    '/imei-check?next=%2Faccount'
  );
});
