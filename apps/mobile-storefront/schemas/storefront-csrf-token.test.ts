import { StorefrontCsrfTokenSchema } from './storefront-csrf-token';

it('accepts an opaque CSRF header token', () => {
  expect(StorefrontCsrfTokenSchema.parse({ token: 'csrf-token-123' })).toEqual({
    token: 'csrf-token-123',
  });
});

it.each([
  {},
  { token: '' },
  { token: 123 },
  { token: 'bad\r\nheader' },
  { token: ' ' },
  { token: 'a'.repeat(4097) },
])('rejects invalid CSRF payload %j', (value) => {
  expect(StorefrontCsrfTokenSchema.safeParse(value).success).toBe(false);
});
