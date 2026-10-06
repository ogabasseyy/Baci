import { expect, it } from 'vitest';
import { runtimeCompositionCsrfSchemas as schemas } from './piggyvest-runtime-composition-csrf';

it('rejects unsigned tokens and weak or short injected test secrets', () => {
  expect(schemas.secret.safeParse(new Uint8Array(32)).success).toBe(false);
  expect(schemas.secret.safeParse(new Uint8Array(31)).success).toBe(false);
  expect(
    schemas.secret.parse(Uint8Array.from({ length: 32 }, (_, index) => index))
  ).toHaveLength(32);
  expect(schemas.token.safeParse('unsigned').success).toBe(false);
  expect(
    schemas.bootstrap.safeParse({
      csrfToken: 'token',
      expiresAt: 123,
      secret: 'private',
    }).success
  ).toBe(false);
  expect(
    schemas.bootstrap.parse({ csrfToken: 'token', expiresAt: 123 })
  ).toEqual({ csrfToken: 'token', expiresAt: 123 });
});
