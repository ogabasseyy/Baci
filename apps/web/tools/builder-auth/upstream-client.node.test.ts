import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateUpstreamEndpoints } from './upstream-client.ts';

test('only configured HTTPS upstream endpoints with no query credentials or alternate origin are accepted', () => {
  const issuer = 'https://project.supabase.co/auth/v1';
  assert.doesNotThrow(() =>
    validateUpstreamEndpoints(issuer, {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
    })
  );
  for (const bad of [
    'http://project.supabase.co/auth/v1/oauth/token',
    'https://attacker.invalid/token',
    'https://user:pass@project.supabase.co/auth/v1/oauth/token',
    'https://project.supabase.co/other',
  ])
    assert.throws(() =>
      validateUpstreamEndpoints(issuer, {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: bad,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
      })
    );
});
