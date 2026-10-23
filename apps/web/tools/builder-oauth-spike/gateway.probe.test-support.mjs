import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCandidate } from './candidate-runtime.test-support.mjs';
import { onTermination, startChild, stopChild } from './child-lifecycle.mjs';

const { createLocalJWKSet, jwtVerify, SignJWT } = await loadCandidate('jose');

import { redirect, resource, startFixture } from './fixture-server.mjs';

const dir = mkdtempSync(join(tmpdir(), 'baci-gateway-proof-'));
const checks = [];
const cookies = new Map();
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const jwks = {
  keys: [
    {
      ...privateKey.export({ format: 'jwk' }),
      kid: 'fixture',
      alg: 'ES256',
      use: 'sig',
    },
  ],
};
const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'fixture',
  alg: 'ES256',
  use: 'sig',
};
const keys = createLocalJWKSet({ keys: [publicJwk] });
let provider;
let gateway;
let worker;
onTermination(async () => {
  await stopChild(worker);
  gateway?.closeAllConnections();
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  await provider?.close();
  rmSync(dir, { recursive: true, force: true });
});
const send = (url, body, token, method) =>
  new Promise((resolve, reject) => {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    const req = request(
      url,
      {
        agent: false,
        rejectUnauthorized: false,
        method: method ?? (body ? 'POST' : 'GET'),
        headers: {
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body
            ? {
                'content-type':
                  typeof body === 'string'
                    ? 'application/x-www-form-urlencoded'
                    : 'application/json',
                accept: 'application/json, text/event-stream',
              }
            : {}),
        },
      },
      (res) => {
        for (const value of res.headers['set-cookie'] ?? []) {
          const [pair] = value.split(';');
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
          })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Timeout')));
    req.end(typeof body === 'object' ? JSON.stringify(body) : body);
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
  provider = await startFixture({ dir, jwks });
  let url = `${provider.issuer}/auth?${new URLSearchParams({ client_id: 'baci-openai-local-proof', redirect_uri: redirect, response_type: 'code', scope: 'openid storefront.read', state: 'state', resource, code_challenge: '-4cf-Mzo_qg9-uq0F4QwWhRh4AjcAqNx7SbYVsdmyQM', code_challenge_method: 'S256' })}`;
  let callback;
  for (let i = 0; i < 12; i++) {
    const res = await send(url);
    assert(res.location);
    url = new URL(res.location, url).href;
    if (url.startsWith(redirect)) {
      callback = new URL(url);
      break;
    }
  }
  assert(callback?.searchParams.get('code'));
  // Use a derived S256 verifier, not a bypassed/seeded authorization code.
  const verifier = '01234567890123456789012345678901234567890123456789';
  const exchanged = await send(
    `${provider.issuer}/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'baci-openai-local-proof',
      redirect_uri: redirect,
      code: callback.searchParams.get('code'),
      code_verifier: verifier,
      resource,
    }).toString()
  );
  assert.equal(exchanged.status, 200, exchanged.text);
  const token = JSON.parse(exchanged.text).access_token;
  let hits = 0;
  let redirectMode = false;
  gateway = createServer(
    {
      key: readFileSync(`${dir}/key.pem`),
      cert: readFileSync(`${dir}/cert.pem`),
    },
    async (req, res) => {
      try {
        const bearer = req.headers.authorization?.replace(/^Bearer /, '');
        await jwtVerify(bearer, keys, {
          issuer: provider.issuer,
          audience: resource,
          algorithms: ['ES256'],
        });
        hits++;
        if (redirectMode) {
          res.writeHead(302, { location: '/redirected' });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ resource, boundaryOnly: true }));
      } catch {
        res.writeHead(401);
        res.end();
      }
    }
  );
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayUrl = `https://127.0.0.1:${gateway.address().port}/execute`;
  const launched = startChild(
    new URL('./adapter-worker.test-support.mjs', import.meta.url),
    [
      JSON.stringify({
        gateway: gatewayUrl,
        issuer: provider.issuer,
        resource,
        publicKey: publicJwk,
        keyFile: `${dir}/key.pem`,
        certFile: `${dir}/cert.pem`,
      }),
    ],
    {}
  );
  worker = launched.child;
  const ready = await launched.ready;
  assert(
    ready.environmentKeys.every((key) => key === '__CF_USER_TEXT_ENCODING')
  );
  const adapter = `https://127.0.0.1:${ready.port}/mcp`;
  const init = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'local-proof', version: '1' },
    },
  };
  assert.equal((await send(adapter, init, token)).status, 200);
  checks.push('SDK v2 transport accepts provider-issued audience');
  const result = await send(
    adapter,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'inspect_builder_boundary', arguments: {} },
    },
    token
  );
  assert.equal(result.status, 200);
  assert(!JSON.parse(result.text).result.isError, result.text);
  assert.equal(hits, 1);
  checks.push('same audience at separate fixed gateway');
  assert.equal((await send(adapter, init, 'invalid-token')).status, 401);
  assert.equal((await send(gatewayUrl, {}, 'invalid-token')).status, 401);
  checks.push('invalid token rejected at adapter and gateway');
  for (const patch of [
    { aud: 'https://wrong.invalid' },
    { iss: 'https://wrong.invalid' },
    { exp: 1 },
  ]) {
    const invalid = await new SignJWT({ scope: 'storefront.read', ...patch })
      .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
      .setIssuer(patch.iss ?? provider.issuer)
      .setAudience(patch.aud ?? resource)
      .setExpirationTime(patch.exp ?? '1h')
      .sign(privateKey);
    assert.equal((await send(adapter, init, invalid)).status, 401);
    assert.equal((await send(gatewayUrl, {}, invalid)).status, 401);
  }
  checks.push('wrong audience issuer and expiry rejected at both components');
  const before = hits;
  await send(
    adapter,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'inspect_builder_boundary',
        arguments: { url: 'https://attacker.invalid' },
      },
    },
    token
  );
  assert.equal(hits, before + 1);
  checks.push('caller cannot select forwarding destination');
  redirectMode = true;
  const previous = hits;
  const blocked = await send(
    adapter,
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'inspect_builder_boundary', arguments: {} },
    },
    token
  );
  assert.equal(JSON.parse(blocked.text).result.isError, true);
  assert.equal(hits, previous + 1);
  checks.push('gateway redirects are not followed');
  checks.push('adapter child starts with no inherited credentials');
  console.log(
    JSON.stringify({
      checks,
      scope:
        'local transport boundary; no production gateway or upstream vault',
    })
  );
} finally {
  await stopChild(worker);
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  await provider?.close();
  rmSync(dir, { recursive: true, force: true });
}
