import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair } from 'jose';
import { createBuilderProvider } from './provider.ts';

test('provider refuses missing callback, HTTP hosts and reused signing/cookie configuration', async () => {
  const keys = await generateKeyPair('ES256', { extractable: true });
  const jwk = {
    ...(await exportJWK(keys.privateKey)),
    alg: 'ES256',
    kid: 'fixture',
  };
  for (const invalid of [
    { callback: 'http://chatgpt.com/callback' },
    { issuer: 'http://auth.usebaci.com' },
    { cookieKeys: [] },
    { jwks: { keys: [] } },
  ]) {
    assert.throws(() =>
      createBuilderProvider(
        {
          issuer: 'https://auth.usebaci.com',
          resource: 'https://mcp.usebaci.com/builder/mcp',
          callback: 'https://chatgpt.com/approved-callback',
          clientId: 'new-builder-client',
          cookieKeys: ['fixture-cookie-key-with-more-than-32-bytes'],
          jwks: { keys: [jwk] },
          ...invalid,
        },
        {} as never
      )
    );
  }
});
