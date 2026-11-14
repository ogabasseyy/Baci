import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { decodeJwt, exportJWK, generateKeyPair, jwtVerify } from 'jose';
import { z } from 'zod';
import { createBuilderProvider } from '../../tools/builder-auth/provider';
import { createBuilderAuthHandler } from '../../tools/builder-auth/server';
import {
  createTestBrowser,
  requireString,
} from '../../tools/builder-auth/test-browser';
import type { experienceDataFixture } from './data-fixture.test-support';

/** Real local broker and PKCE flow; only the upstream identity provider is synthetic. */
export async function syntheticOAuth(
  f: Pick<
    Awaited<ReturnType<typeof experienceDataFixture>>,
    'db' | 'owner' | 'merchantId'
  > & { actorId: string },
  dir: string,
  ownedMerchantId: string | null = f.merchantId
) {
  const issuer = 'https://builder-auth.usebaci.com';
  const resource = 'https://mcp.usebaci.com/builder/mcp';
  const upstreamExpiresAt =
    z.number().parse(decodeJwt(f.owner.accessToken).exp) * 1000;
  const callback = 'https://chatgpt.com/new-builder-callback';
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
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' }
  );
  const key = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = {
    ...(await exportJWK(key.publicKey)),
    alg: 'ES256',
    kid: 'local',
  };
  const provider = await createBuilderProvider(
    {
      issuer,
      resource,
      callback,
      clientId: 'new-builder-client',
      cookieKeys: [randomBytes(32).toString('base64url')],
      jwks: {
        keys: [
          { ...(await exportJWK(key.privateKey)), alg: 'ES256', kid: 'local' },
        ],
      },
    },
    f.db.storage
  );
  let state = '';
  const handle = createBuilderAuthHandler({
    provider,
    storage: f.db.storage,
    issuer,
    resource,
    upstream: {
      begin: () => {
        state = randomBytes(32).toString('hex');
        return Promise.resolve({
          url: new URL(`https://upstream.invalid/auth?state=${state}`),
          transaction: {
            state,
            nonce: 'fixture-nonce',
            verifier: 'fixture-verifier',
            redirectUri: `${issuer}/upstream/callback`,
            createdAt: Date.now(),
          },
        });
      },
      complete: (url, transaction) => {
        assert(
          transaction &&
            typeof transaction === 'object' &&
            'state' in transaction
        );
        assert.equal(url.searchParams.get('state'), transaction.state);
        return Promise.resolve({
          subject: f.actorId,
          tokens: {
            accessToken: f.owner.accessToken,
            refreshToken: 'synthetic-refresh',
            expiresAt: upstreamExpiresAt,
          },
        });
      },
      refresh: async () => ({
        accessToken: f.owner.accessToken,
        refreshToken: 'synthetic-refresh-rotated',
        expiresAt: upstreamExpiresAt,
      }),
    },
    supabase: {
      url: 'https://fixture.supabase.co',
      anonKey: 'fixture-public',
      fetchImpl: async (input) =>
        Response.json(
          String(input).includes('/auth/v1/user')
            ? { id: f.actorId, aud: 'authenticated', role: 'authenticated' }
            : ownedMerchantId
              ? [{ id: ownedMerchantId }]
              : []
        ),
    },
    connectionTtlSeconds: 3600,
    authenticateDisconnect: () =>
      Promise.reject(Error('No authenticated browser')),
  });
  const server = createServer(
    {
      key: readFileSync(join(dir, 'key.pem')),
      cert: readFileSync(join(dir, 'cert.pem')),
    },
    (req, res) => {
      void handle(req, res);
    }
  );
  await new Promise<void>((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const { send } = createTestBrowser(issuer, address.port);
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      client_id: 'new-builder-client',
      redirect_uri: callback,
      response_type: 'code',
      scope: 'openid offline_access storefront.read storefront.write',
      state: 'outer-state',
      nonce: 'outer-nonce',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource,
      prompt: 'consent',
    });
    const start = await send(`/auth?${params}`);
    assert.equal(start.status, 303);
    const login = await send(requireString(start.location));
    assert.equal(login.status, 303);
    assert.equal(
      new URL(requireString(login.location)).origin,
      'https://upstream.invalid'
    );
    const inner = await send(
      `/upstream/callback?code=synthetic&state=${state}`
    );
    assert.equal(inner.status, 303);
    const consent = await send(requireString(inner.location));
    assert.equal(consent.status, 200);
    const csrf = /name="csrf" value="([^"]+)"/.exec(consent.text)?.[1];
    assert(csrf);
    let result = await send(requireString(inner.location), {
      csrf,
      decision: 'approve',
      create: 'yes',
    });
    assert.equal(result.status, 303);
    for (let i = 0; i < 6 && !result.location?.startsWith(callback); i++)
      result = await send(requireString(result.location));
    assert(result.location?.startsWith(callback));
    const resultUrl = new URL(requireString(result.location));
    assert.equal(resultUrl.searchParams.get('iss'), issuer);
    assert.equal(resultUrl.searchParams.get('state'), 'outer-state');
    const exchange = await send('/token', {
      client_id: 'new-builder-client',
      grant_type: 'authorization_code',
      redirect_uri: callback,
      code: requireString(resultUrl.searchParams.get('code')),
      code_verifier: verifier,
      resource,
    });
    assert.equal(exchange.status, 200);
    const { access_token: token, refresh_token: initialRefresh } = JSON.parse(
      exchange.text
    ) as {
      access_token: string;
      refresh_token: string;
    };
    let refreshToken = requireString(initialRefresh);
    const claims = await jwtVerify(token, key.publicKey, {
      issuer,
      audience: resource,
      algorithms: ['ES256'],
      typ: 'at+jwt',
    });
    assert.equal(claims.payload.sub, f.actorId);
    return {
      token,
      publicJwk,
      connectionId: String(claims.payload.connectionId),
      async refresh() {
        const refreshServer = createServer(
          {
            key: readFileSync(join(dir, 'key.pem')),
            cert: readFileSync(join(dir, 'cert.pem')),
          },
          (req, res) => {
            void handle(req, res);
          }
        );
        await new Promise<void>((resolve, reject) =>
          refreshServer.once('error', reject).listen(0, '127.0.0.1', resolve)
        );
        try {
          const refreshAddress = refreshServer.address();
          assert(refreshAddress && typeof refreshAddress === 'object');
          const refreshed = await createTestBrowser(
            issuer,
            refreshAddress.port
          ).send('/token', {
            client_id: 'new-builder-client',
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            resource,
          });
          assert.equal(refreshed.status, 200);
          const result = JSON.parse(refreshed.text) as {
            access_token: string;
            refresh_token: string;
          };
          refreshToken = requireString(result.refresh_token);
          return requireString(result.access_token);
        } finally {
          await new Promise<void>((resolve, reject) =>
            refreshServer.close((error) => (error ? reject(error) : resolve()))
          );
        }
      },
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
