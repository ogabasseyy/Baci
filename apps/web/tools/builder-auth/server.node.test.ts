import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportJWK, generateKeyPair } from 'jose';
import { startAuthQualification } from '../builder-production/auth-qualification.ts';
import { listenPrivateAuth } from './auth-listener.ts';
import {
  checkBrokerRefresh,
  createBrokerTestCertificate,
} from './broker-refresh-test-support.ts';
import { createBuilderProvider } from './provider.ts';
import { createBuilderAuthHandler } from './server.ts';
import { createTestBrowser, requireString } from './test-browser.ts';
import { databaseFixture } from './test-fixtures.ts';

const actor = '10000000-0000-4000-8000-000000000001';
const resource = 'https://builder-mcp.usebaci.com/builder/mcp';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
for (const viaBridge of [false, true])
  test(`real broker redirects, consent and token isolation (bridge: ${viaBridge})`, {
    timeout: 90000,
  }, async () => {
    const db = await databaseFixture();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'baci-builder-auth-')));
    let server: ReturnType<typeof createServer> | undefined;
    let bridge: Awaited<ReturnType<typeof startAuthQualification>> | undefined;
    const observed: string[] = [];
    try {
      await db.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
      createBrokerTestCertificate(dir);
      let handle: ReturnType<typeof createBuilderAuthHandler>;
      server = createServer(
        {
          key: readFileSync(join(dir, 'key.pem')),
          cert: readFileSync(join(dir, 'cert.pem')),
        },
        (req, res) => {
          if (!viaBridge) {
            void handle(req, res);
            return;
          }
          const target = new URL(bridge?.origin ?? 'http://127.0.0.1:1');
          const upstream = httpRequest(
            {
              hostname: '127.0.0.1',
              port: Number(target.port),
              method: req.method,
              path: req.url,
              headers: req.headers,
              agent: false,
            },
            (reply) => {
              observed.push(
                `${new URL(req.url ?? '/', issuer).pathname}:${reply.statusCode}`
              );
              res.writeHead(reply.statusCode ?? 502, reply.headers);
              reply.pipe(res);
            }
          );
          upstream.on('error', () => res.writeHead(502).end());
          req.pipe(upstream);
        }
      );
      await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r));
      const address = server.address();
      assert(address && typeof address === 'object');
      const issuer = viaBridge
        ? 'https://builder-auth.usebaci.com'
        : `https://127.0.0.1:${address.port}`;
      const key = await generateKeyPair('ES256', { extractable: true });
      const provider = await createBuilderProvider(
        {
          issuer,
          resource,
          callback,
          clientId: 'new-builder-client',
          cookieKeys: [randomBytes(32).toString('base64url')],
          jwks: {
            keys: [
              {
                ...(await exportJWK(key.privateKey)),
                alg: 'ES256',
                kid: 'local',
              },
            ],
          },
        },
        db.storage
      );
      const prompts: string[] = [];
      provider.on('interaction.started', (_ctx, interaction) => {
        prompts.push(interaction.name);
      });
      let expectedState = '';
      const upstream = {
        begin: async () => {
          expectedState = randomBytes(32).toString('hex');
          return {
            url: new URL(
              `https://upstream.invalid/auth?state=${expectedState}`
            ),
            transaction: {
              state: expectedState,
              nonce: 'fixture-nonce',
              verifier: 'fixture-verifier',
              redirectUri: `${issuer}/upstream/callback`,
              createdAt: Date.now(),
            },
          };
        },
        complete: async (url: URL, tx: unknown) => {
          assert.equal(
            url.searchParams.get('state'),
            (tx as { state: string }).state
          );
          return {
            subject: actor,
            tokens: {
              accessToken: 'dedicated-upstream-access',
              refreshToken: 'dedicated-upstream-refresh',
              expiresAt: Date.now() + 300000,
            },
          };
        },
        refresh: async () => ({
          accessToken: 'refreshed',
          refreshToken: 'rotated',
          expiresAt: Date.now() + 300000,
        }),
      };
      let ownedTarget: string | null = null;
      const fakeFetch: typeof fetch = async (input) => {
        const url = String(input);
        return Response.json(
          url.includes('/auth/v1/user')
            ? { id: actor, aud: 'authenticated', role: 'authenticated' }
            : ownedTarget
              ? [{ id: ownedTarget }]
              : []
        );
      };
      handle = createBuilderAuthHandler({
        provider,
        storage: db.storage,
        upstream,
        issuer,
        resource,
        supabase: {
          url: 'https://fixture.supabase.co',
          anonKey: 'fixture-public',
          fetchImpl: fakeFetch,
        },
        connectionTtlSeconds: 3600,
        authenticateDisconnect: async () => {
          throw new Error('No authenticated browser');
        },
      });
      if (viaBridge) {
        const socketPath = join(dir, 'broker.sock');
        bridge = await startAuthQualification(0, async () => ({
          socketPath,
          ...(await listenPrivateAuth({
            socketPath,
            issuer,
            provider,
            handler: async (req, res) => {
              observed.push(
                `broker:${new URL(req.url ?? '/', issuer).pathname}`
              );
              await handle(req, res);
            },
          })),
        }));
      }
      const { jar, send } = createTestBrowser(
        issuer,
        viaBridge ? address.port : undefined
      );
      const verifier = randomBytes(32).toString('base64url');
      const authPath = `/auth?${new URLSearchParams({ client_id: 'new-builder-client', redirect_uri: callback, response_type: 'code', scope: 'openid offline_access storefront.read storefront.write', state: 'outer-state', nonce: 'outer-nonce', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource, prompt: 'consent' })}`;
      async function authorize(changeTarget = false) {
        const start = await send(authPath);
        assert.equal(start.status, 303);
        const interaction = requireString(start.location);
        const login = await send(interaction);
        assert.equal(
          login.status,
          303,
          `Interaction returned ${login.status}: ${login.text}; ${observed.join(',')}`
        );
        assert.equal(
          new URL(requireString(login.location)).origin,
          'https://upstream.invalid'
        );
        assert(
          [...jar.values()].some((c) => c.path.startsWith('/interaction/')),
          'real provider cookie is path-scoped'
        );
        const innerReturn = await send(
          `/upstream/callback?code=synthetic&state=${expectedState}`
        );
        assert.equal(innerReturn.status, 303);
        const consent = await send(requireString(innerReturn.location));
        assert.equal(consent.status, 200);
        assert(!consent.text.includes('dedicated-upstream'));
        assert(!consent.text.includes('refreshToken'));
        const csrf = /name="csrf" value="([^"]+)"/.exec(consent.text)?.[1];
        assert(csrf);
        if (changeTarget) ownedTarget = '30000000-0000-4000-8000-000000000001';
        const approved = await send(requireString(innerReturn.location), {
          csrf,
          decision: 'approve',
          create: 'yes',
        });
        if (changeTarget) {
          assert.equal(approved.status, 400);
          ownedTarget = null;
          throw new Error('Consent target changed');
        }
        assert.equal(approved.status, 303);
        let result = approved;
        for (let i = 0; i < 6 && !result.location?.startsWith(callback); i++) {
          assert(
            result.location,
            `Missing redirect, status ${result.status}; ${observed.join(',')}`
          );
          assert.equal(
            new URL(requireString(result.location), issuer).origin,
            issuer,
            `Unexpected next redirect after approval, step ${i}, prompts ${prompts.join(',')}`
          );
          result = await send(requireString(result.location));
        }
        assert(result.location?.startsWith(callback));
        const callbackUrl = new URL(requireString(result.location));
        // OpenAI's shared OAuth callback requires the issuer on success as well
        // as on errors, to identify which authorization server issued the code.
        assert.equal(callbackUrl.searchParams.get('iss'), issuer);
        assert.equal(callbackUrl.searchParams.get('state'), 'outer-state');
        const code = callbackUrl.searchParams.get('code');
        assert(code);
        const exchange = await send('/token', {
          client_id: 'new-builder-client',
          grant_type: 'authorization_code',
          redirect_uri: callback,
          code,
          code_verifier: verifier,
          resource,
        });
        assert.equal(exchange.status, 200);
        const tokens = JSON.parse(exchange.text);
        assert(tokens.refresh_token);
        assert(!exchange.text.includes('dedicated-upstream'));
        assert(
          !JSON.stringify(
            (
              await db.pool.query(
                'SELECT id,uid,user_code,payload FROM builder_authorization.provider_records'
              )
            ).rows
          ).includes(tokens.refresh_token)
        );
        return tokens as { access_token: string; refresh_token: string };
      }
      await checkBrokerRefresh({
        authorize,
        browser: { send, jar },
        authPath,
        key,
        db,
        actor,
        issuer,
        resource,
      });
    } finally {
      if (server) await new Promise<void>((r) => server?.close(() => r()));
      await bridge?.close();
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
