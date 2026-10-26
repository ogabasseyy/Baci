import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTermination } from './child-lifecycle.mjs';
import { openaiClient, selectClientMetadata } from './client-metadata.mjs';
import { redirect, resource, startFixture } from './fixture-server.mjs';

const checks = [];
const dir = mkdtempSync(join(tmpdir(), 'baci-cimd-proof-'));
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwks = {
  keys: [
    {
      ...privateKey.export({ format: 'jwk' }),
      alg: 'ES256',
      kid: 'fixture',
      use: 'sig',
    },
  ],
};
const document = {
  client_id: openaiClient,
  redirect_uris: [redirect],
  response_types: ['code'],
  grant_types: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  token_endpoint_auth_method: 'private_key_jwt',
};
let fixture;
onTermination(async () => {
  await fixture?.close();
  rmSync(dir, { recursive: true, force: true });
});

function get(url) {
  return new Promise((resolve, reject) => {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    const req = request(
      url,
      { agent: false, rejectUnauthorized: false },
      (res) => {
        let body = '';
        res.on('data', (value) => (body += value));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            body,
          })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Timeout')));
    req.end();
  });
}
const authorize = (id) =>
  get(
    `${fixture.issuer}/auth?${new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'openid storefront.read', state: 'fixture', resource, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`
  );
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      `${dir}/key.pem`,
      '-out',
      `${dir}/cert.pem`,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' }
  );
  assert.equal(
    selectClientMetadata(document).token_endpoint_auth_method,
    'none'
  );
  const pluralOnly = { ...document };
  delete pluralOnly.token_endpoint_auth_method;
  assert.equal(
    selectClientMetadata(pluralOnly).token_endpoint_auth_method,
    'none'
  );
  assert.equal(
    selectClientMetadata({ ...document, token_endpoint_auth_method: 'none' })
      .token_endpoint_auth_method,
    'none'
  );
  checks.push('plural methods and compatible singular preference');
  for (const bad of [
    { ...document, client_id: 'https://attacker.invalid/client.json' },
    {
      ...document,
      redirect_uris: [redirect, 'https://attacker.invalid/callback'],
    },
    {
      ...document,
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    },
  ])
    assert.throws(() => selectClientMetadata(bad));
  checks.push('exact document and callback validation');
  const fetches = [];
  fixture = await startFixture({ dir, jwks, metadata: document, fetches });
  if (process.argv.includes('--hold-for-interruption')) {
    process.send?.({ dir });
    await new Promise(() => {
      /* Interrupted-execution test holds until SIGTERM. */
    });
  }
  const accepted = await authorize(openaiClient);
  assert.equal(accepted.status, 303, accepted.body);
  assert(
    new URL(accepted.location, fixture.issuer).pathname.startsWith(
      '/interaction/'
    )
  );
  checks.push('provider resolves normalized CIMD');
  for (const id of [
    'https://127.0.0.1/client.json',
    'https://10.0.0.1/client.json',
    'https://169.254.169.254/client.json',
    'https://[::1]/client.json',
    'https://attacker.invalid/client.json',
  ]) {
    const denied = await authorize(id);
    assert(denied.status >= 400);
  }
  assert.deepEqual(fetches, [openaiClient]);
  checks.push('private and unknown client URLs rejected before fetch');
  await fixture.close();
  fixture = await startFixture({
    dir,
    jwks,
    metadata: document,
    metadataStatus: 302,
  });
  const redirected = await authorize(openaiClient);
  assert(redirected.status >= 400);
  checks.push('redirecting metadata rejected');
  console.log(
    JSON.stringify({
      checks,
      scope:
        'synthetic CIMD with explicit metadata selection adapter; no live registration',
    })
  );
} finally {
  await fixture?.close();
  rmSync(dir, { recursive: true, force: true });
}
