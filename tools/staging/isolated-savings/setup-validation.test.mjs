import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSetup } from './setup-validation.mjs';

function fixture() {
  return {
    ISOLATED_POSTGRES_PASSWORD: 'a'.repeat(64),
    ISOLATED_AUTH_DB_PASSWORD: 'b'.repeat(64),
    ISOLATED_REST_DB_PASSWORD: 'c'.repeat(64),
    ISOLATED_JWT_SECRET: 'd'.repeat(64),
    ISOLATED_API_ORIGIN: 'https://staging-auth.example.test',
    ISOLATED_AUTH_ISSUER: 'https://staging-auth.example.test/auth/v1',
    ISOLATED_SITE_URL: 'https://staging.example.test/account',
    ISOLATED_PARENT_REVIEW: 'private-services-reviewed',
  };
}

test('validates format and separation without generating or returning secrets', () => {
  assert.equal(validateSetup(fixture()), undefined);
});

test('rejects missing, empty, duplicate and URI-unsafe credentials', () => {
  for (const name of [
    'ISOLATED_POSTGRES_PASSWORD',
    'ISOLATED_AUTH_DB_PASSWORD',
    'ISOLATED_REST_DB_PASSWORD',
    'ISOLATED_JWT_SECRET',
  ]) {
    for (const value of [
      undefined,
      '',
      'unsafe@password',
      fixture().ISOLATED_POSTGRES_PASSWORD,
    ]) {
      if (
        name === 'ISOLATED_POSTGRES_PASSWORD' &&
        value === fixture().ISOLATED_POSTGRES_PASSWORD
      )
        continue;
      assert.throws(() => validateSetup({ ...fixture(), [name]: value }));
    }
  }
});

test('rejects production and ambient infrastructure settings', () => {
  for (const name of [
    'DATABASE_URL',
    'SUPABASE_URL',
    'PGHOST',
    'POSTGRES_PASSWORD',
    'COMPOSE_FILE',
    'DOCKER_HOST',
    'SMTP_HOST',
    'PAYSTACK_SECRET_KEY',
  ]) {
    assert.throws(() =>
      validateSetup({ ...fixture(), [name]: 'forbidden-test-value' })
    );
  }
});

test('rejects root issuer, wrong issuer, production origin and absent review', () => {
  for (const change of [
    { ISOLATED_AUTH_ISSUER: 'https://staging-auth.example.test' },
    { ISOLATED_AUTH_ISSUER: 'https://other.example.test/auth/v1' },
    { ISOLATED_API_ORIGIN: 'https://ogabassey.com' },
    { ISOLATED_API_ORIGIN: 'https://staging-auth.example.test/auth/v1' },
    { ISOLATED_SITE_URL: 'https://ogabassey.com' },
    { ISOLATED_SITE_URL: 'https://staging.example.test/*' },
    { ISOLATED_PARENT_REVIEW: undefined },
  ])
    assert.throws(() => validateSetup({ ...fixture(), ...change }));
});
