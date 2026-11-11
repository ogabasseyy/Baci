import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { exportJWK, generateKeyPair } from 'jose';
import { parseProductionAuthConfig } from './production-config.ts';

async function fixture() {
  const key = await generateKeyPair('ES256', { extractable: true });
  return {
    databaseUrl:
      'postgresql://baci_builder_auth_login.fixture:password@pooler.example.test:5432/postgres',
    socketPath: '/run/baci-builder-auth/broker.sock',
    clientId: 'baci-chatgpt-builder-v1',
    callback: 'https://chatgpt.com/connector_platform_oauth_redirect',
    cookieKeys: [randomBytes(32).toString('base64url')],
    signingKeys: [
      { ...(await exportJWK(key.privateKey)), alg: 'ES256', kid: 'fixture' },
    ],
    vault: {
      activeKeyId: 'v1',
      keys: { v1: randomBytes(32).toString('base64url') },
    },
    upstream: {
      issuer: 'https://project.supabase.co/auth/v1',
      clientId: 'inner-client',
      clientSecret: 'synthetic-client-secret',
    },
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic',
    },
    connectionTtlSeconds: 86400,
  };
}

test('binds a production broker to the dedicated resource and verified upstream', async () => {
  const config = parseProductionAuthConfig(await fixture());
  assert.equal(config.provider.issuer, 'https://mcp.usebaci.com');
  assert.equal(config.provider.resource, 'https://mcp.usebaci.com/builder/mcp');
  assert.equal(
    config.upstream.redirectUri,
    'https://mcp.usebaci.com/upstream/callback'
  );
  assert.equal(config.vault.keys.get('v1')?.byteLength, 32);
});

test('rejects broad database roles, insecure transport and mismatched upstreams', async () => {
  const config = await fixture();
  for (const bad of [
    {
      ...config,
      databaseUrl:
        'postgresql://postgres:password@pooler.example.test/postgres',
    },
    { ...config, databaseUrl: `${config.databaseUrl}?sslmode=disable` },
    {
      ...config,
      databaseUrl:
        'postgresql://baci_builder_auth_login.fixture:password@pooler.example.test:6543/postgres',
    },
    { ...config, callback: 'http://chatgpt.com/callback' },
    { ...config, socketPath: '/run/baci-builder-auth/../other.sock' },
    {
      ...config,
      supabase: { ...config.supabase, url: 'https://other.supabase.co' },
    },
  ])
    assert.throws(() => parseProductionAuthConfig(bad), /INVALID_AUTH_CONFIG/);
});

test('rejects missing or reused vault keys and unknown configuration', async () => {
  const config = await fixture();
  for (const bad of [
    { ...config, vault: { activeKeyId: 'missing', keys: config.vault.keys } },
    {
      ...config,
      vault: { activeKeyId: 'v1', keys: { v1: config.cookieKeys[0] } },
    },
    {
      ...config,
      upstream: { ...config.upstream, clientSecret: config.cookieKeys[0] },
    },
    {
      ...config,
      supabase: { ...config.supabase, anonKey: 'sb_secret_not-public' },
    },
    { ...config, extra: 'unexpected' },
  ])
    assert.throws(() => parseProductionAuthConfig(bad), /INVALID_AUTH_CONFIG/);
});

test('accepts only the dedicated login principal instead of the NOLOGIN storage role', async () => {
  const config = await fixture();
  assert.doesNotThrow(() =>
    parseProductionAuthConfig({
      ...config,
      databaseUrl:
        'postgresql://baci_builder_auth_login.fixture:password@pooler.example.test:5432/postgres',
    })
  );
  assert.throws(
    () =>
      parseProductionAuthConfig({
        ...config,
        databaseUrl:
          'postgresql://baci_builder_auth_storage.fixture:password@pooler.example.test:5432/postgres',
      }),
    /INVALID_AUTH_CONFIG/
  );
});
