import { describe, expect, it } from 'vitest';
import { sanitizeRedirect } from './customer-login-redirect';

describe('sanitizeRedirect', () => {
  it.each([
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
  ])('rejects unsafe redirect %j', (input) => {
    expect(sanitizeRedirect(input)).toBe('/account');
  });
  it('preserves a local redirect', () =>
    expect(sanitizeRedirect('/imei-check')).toBe('/imei-check'));
});
