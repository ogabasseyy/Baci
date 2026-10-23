import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { onTermination, startChild, stopChild } from './child-lifecycle.mjs';
import { redirect, resource, startFixture } from './fixture-server.mjs';

const dir = mkdtempSync(join(tmpdir(), 'baci-oauth-proof-'));
const checks = [];
let fixture;
let replica;
onTermination(async () => {
  await stopChild(replica);
  await fixture?.close();
  rmSync(dir, { recursive: true, force: true });
});
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwks = {
  keys: [
    {
      ...privateKey.export({ format: 'jwk' }),
      kid: 'local-fixture',
      alg: 'ES256',
      use: 'sig',
    },
  ],
};
const cookies = new Map();
function send(url, form, bearer) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  return new Promise((resolve, reject) => {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const req = request(
      url,
      {
        agent: false,
        rejectUnauthorized: false,
        method: form ? 'POST' : 'GET',
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(form
            ? {
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (res) => {
        for (const value of res.headers['set-cookie'] ?? []) {
          const pair = value.split(';')[0];
          const at = pair.indexOf('=');
          cookies.set(pair.slice(0, at), pair.slice(at + 1));
        }
        let text = '';
        res.on('data', (data) => (text += data));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            text,
            json: () => JSON.parse(text),
          })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () =>
      req.destroy(new Error('Fixture request timeout'))
    );
    req.end(body);
  });
}
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
async function authorize(overrides = {}) {
  const query = {
    client_id: 'baci-openai-local-proof',
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email offline_access storefront.read',
    state: 'outer-state',
    nonce: 'outer-nonce',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
    prompt: 'consent',
    ...overrides,
  };
  for (const key of Object.keys(query))
    if (query[key] === undefined) delete query[key];
  let url = `${fixture.issuer}/auth?${new URLSearchParams(query)}`;
  for (let i = 0; i < 12; i++) {
    const res = await send(url);
    if (!res.location) return { response: res };
    url = new URL(res.location, url).href;
    if (url.startsWith(redirect))
      return { callback: new URL(url), response: res };
    assert.equal(new URL(url).origin, fixture.issuer);
  }
  throw new Error('Fixture redirect limit');
}
const exchange = (code, extra = {}, origin = fixture.issuer) =>
  send(`${origin}/token`, {
    grant_type: 'authorization_code',
    client_id: 'baci-openai-local-proof',
    redirect_uri: redirect,
    code,
    code_verifier: verifier,
    resource,
    ...extra,
  });
const refresh = (token) =>
  send(`${fixture.issuer}/token`, {
    grant_type: 'refresh_token',
    client_id: 'baci-openai-local-proof',
    refresh_token: token,
    resource,
  });
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
  fixture = await startFixture({ dir, jwks });
  const meta = (
    await send(`${fixture.issuer}/.well-known/openid-configuration`)
  ).json();
  assert.equal(meta.issuer, fixture.issuer);
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  assert.equal(meta.registration_endpoint, undefined);
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
  checks.push('HTTPS discovery and S256');
  for (const [name, overrides] of [
    [
      'missing PKCE rejected',
      { code_challenge: undefined, code_challenge_method: undefined },
    ],
    [
      'plain PKCE rejected',
      { code_challenge: verifier, code_challenge_method: 'plain' },
    ],
    [
      'unknown redirect rejected',
      { redirect_uri: 'https://example.invalid/escape' },
    ],
    [
      'wrong authorization resource rejected',
      { resource: 'https://example.invalid/api' },
    ],
  ]) {
    const result = await authorize(overrides);
    assert(
      result.callback?.searchParams.has('error') ||
        result.response.status >= 400,
      name
    );
    if (result.callback)
      assert.equal(result.callback.searchParams.get('iss'), fixture.issuer);
    checks.push(name);
  }
  let result = await authorize();
  assert(result.callback?.searchParams.has('code'), result.response.text);
  assert.equal(result.callback.searchParams.get('iss'), fixture.issuer);
  let token = await exchange(result.callback.searchParams.get('code'), {
    resource: 'https://example.invalid/api',
  });
  assert.equal(token.status, 400);
  checks.push('wrong exchange resource rejected');
  result = await authorize();
  token = await exchange(result.callback.searchParams.get('code'));
  assert.equal(token.status, 200, token.text);
  const first = token.json();
  assert(first.refresh_token);
  assert(first.id_token);
  const claims = JSON.parse(
    Buffer.from(first.access_token.split('.')[1], 'base64url').toString()
  );
  assert.equal(claims.iss, fixture.issuer);
  assert.equal(claims.aud, resource);
  assert.equal(claims.sub, 'synthetic-owner');
  assert.equal(typeof claims.connectionId, 'string');
  assert.equal(claims.grantVersion, 1);
  assert.equal(typeof claims.exp, 'number');
  assert.equal(typeof claims.scope, 'string');
  checks.push('builder token claim contract');
  checks.push('valid code exchange');
  result = await authorize();
  const launched = startChild(
    new URL('./provider-worker.mjs', import.meta.url),
    [JSON.stringify({ dir, jwks, issuerOverride: fixture.issuer })],
    {
      BACI_OAUTH_CANDIDATE_DIR: resolve(
        process.env.BACI_OAUTH_CANDIDATE_DIR ??
          new URL('./candidate', import.meta.url).pathname
      ),
    }
  );
  replica = launched.child;
  const ready = await launched.ready;
  const concurrent = await Promise.all([
    exchange(result.callback.searchParams.get('code')),
    exchange(result.callback.searchParams.get('code'), {}, ready.origin),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 400]);
  checks.push('two provider processes consume code once');
  const next = await refresh(first.refresh_token);
  assert.equal(next.status, 200, next.text);
  const rotated = next.json();
  assert.notEqual(first.refresh_token, rotated.refresh_token);
  assert.equal((await refresh(first.refresh_token)).status, 400);
  assert.equal((await refresh(rotated.refresh_token)).status, 400);
  checks.push('rotation and family reuse revocation');
  result = await authorize();
  const persistent = (
    await exchange(result.callback.searchParams.get('code'))
  ).json();
  result = await authorize({ scope: 'openid email storefront.read' });
  const online = (
    await exchange(result.callback.searchParams.get('code'))
  ).json();
  assert.equal(online.refresh_token, undefined);
  fixture.setConsentAllowed(false);
  const declined = await authorize({ prompt: undefined });
  assert.equal(declined.callback.searchParams.get('error'), 'access_denied');
  assert.equal(declined.callback.searchParams.has('code'), false);
  fixture.setConsentAllowed(true);
  checks.push('offline access requires granted scope and consent');
  result = await authorize();
  const infoToken = (
    await send(
      `${fixture.issuer}/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'baci-openai-local-proof',
        redirect_uri: redirect,
        code: result.callback.searchParams.get('code'),
        code_verifier: verifier,
      }).toString()
    )
  ).json();
  const info = await send(
    meta.userinfo_endpoint,
    undefined,
    infoToken.access_token
  );
  assert.equal(info.status, 200, info.text);
  assert.equal(info.json().email_verified, true);
  assert.equal(info.json().sub, 'synthetic-owner');
  checks.push('outer verified email UserInfo');
  const hint = await authorize({ id_token_hint: first.id_token });
  assert(hint.callback.searchParams.has('code'));
  checks.push('safe reauthorization with ID token hint');
  const port = Number(new URL(fixture.issuer).port);
  await fixture.close();
  fixture = await startFixture({ dir, jwks, port });
  assert.equal((await refresh(persistent.refresh_token)).status, 200);
  checks.push('restart persistence');
  assert.equal((await refresh(rotated.refresh_token)).status, 400);
  checks.push('revocation survives restart');
  const fresh = await authorize();
  assert(fresh.callback.searchParams.has('code'));
  checks.push('predefined client survives restart');
  console.log(
    JSON.stringify({
      provider: 'oidc-provider@9.12.2',
      node: process.version,
      checks,
      scope: 'local outer provider and persistent fixture adapter',
    })
  );
} finally {
  await stopChild(replica);
  await fixture?.close();
  rmSync(dir, { recursive: true, force: true });
}
