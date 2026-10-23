/** Local acceptance only: real MCP SDK/Node → pinned fixture TLS → real Next gateway/auth. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createBuilderBackendClient } from '../../builder-mcp-server/backend-client';
import { createBuilderMcpHttpHandler } from '../../builder-mcp-server/http';
import { createBuilderTransportVerifier } from '../../builder-mcp-server/token-verifier';

const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'baci-task6-next-'));
const reserve = createServer();
reserve.listen(0, '127.0.0.1');
await once(reserve, 'listening');
const address = reserve.address();
if (!address || typeof address === 'string') throw Error('No fixture port');
const port = address.port;
await new Promise<void>((resolve) => reserve.close(() => resolve()));
const key = path.join(dir, 'tls.key');
const cert = path.join(dir, 'tls.crt');
const file = path.join(dir, 'fixture.json');
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
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ],
  { stdio: 'ignore' }
);
const signing = await generateKeyPair('ES256');
const actor = randomUUID();
const connectionId = randomUUID();
const fixture = {
  publicKey: {
    ...(await exportJWK(signing.publicKey)),
    alg: 'ES256',
    kid: 'task6',
  },
  connection: {
    actorUserId: actor,
    connectionId,
    grantVersion: 1,
    scopes: ['storefront.read'],
    allowedMerchantIds: [],
    allowCreateStore: false,
    status: 'active',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    revokedAt: null as string | null,
  },
};
writeFileSync(file, JSON.stringify(fixture));
const log = openSync(path.join(dir, 'next.log'), 'w');
const child = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    'dev',
    'tools/builder-preview-spike/test-fixtures',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
    '--experimental-https',
    '--experimental-https-key',
    key,
    '--experimental-https-cert',
    cert,
  ],
  {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
      BACI_BUILDER_TASK6_FIXTURE_FILE: file,
    },
  }
);
const callFixture = (target: string, options?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      `https://127.0.0.1:${port}${target}`,
      {
        ca: readFileSync(cert),
        method: options?.method ?? 'GET',
        headers: options?.headers as Record<string, string>,
        signal: options?.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 131072) req.destroy(Error('Fixture response too large'));
          else chunks.push(Buffer.from(chunk));
        });
        res.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: res.headers as Record<string, string>,
            })
          )
        );
      }
    );
    req.setTimeout(90000, () => req.destroy(Error('Fixture timeout')));
    req.on('error', reject);
    req.end(typeof options?.body === 'string' ? options.body : undefined);
  });
let mcp: ReturnType<typeof createBuilderMcpHttpHandler> | undefined;
let server: ReturnType<typeof createServer> | undefined;
let client: Client | undefined;
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw Error('Fixture Next exited');
    try {
      const res = await callFixture('/api/builder-task6/list_storefronts');
      await res.body?.cancel();
      if (res.status === 405) {
        ready = true;
        break;
      }
    } catch {
      /* Owned fixture may not be listening yet, or may already have exited. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Next fixture did not become ready');
  const outer = await new SignJWT({
    connectionId,
    grantVersion: 1,
    scope: 'storefront.read',
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'task6' })
    .setIssuer('https://auth.usebaci.com')
    .setAudience('https://mcp.usebaci.com/builder/mcp')
    .setSubject(actor)
    .setExpirationTime('5m')
    .sign(signing.privateKey);
  const fetchImpl: typeof fetch = (input, options) => {
    assert.equal(
      String(input),
      'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts'
    );
    assert.equal(
      new Headers(options?.headers).get('authorization'),
      `Bearer ${outer}`
    );
    assert.equal(options?.redirect, 'manual');
    return callFixture('/api/builder-task6/list_storefronts', options);
  };
  mcp = createBuilderMcpHttpHandler({
    verifyAccessToken: createBuilderTransportVerifier(signing.publicKey),
    executeBuilderTool: createBuilderBackendClient({ fetchImpl }),
  });
  server = createServer((req, res) => {
    void mcp?.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw Error('No MCP fixture port');
  client = new Client({ name: 'task6-node-next-proof', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${bound.port}/builder/mcp`),
      { requestInit: { headers: { authorization: `Bearer ${outer}` } } }
    )
  );
  assert.equal((await client.listTools()).tools.length, 6);
  const result = await client.callTool({
    name: 'list_storefronts',
    arguments: {},
  });
  assert.deepEqual(result.structuredContent, { stores: [], nextCursor: null });
  assert.notEqual(result.isError, true);
  fixture.connection.status = 'revoked';
  fixture.connection.revokedAt = new Date().toISOString();
  fixture.connection.grantVersion = 2;
  writeFileSync(file, JSON.stringify(fixture));
  const revoked = await client.callTool({
    name: 'list_storefronts',
    arguments: {},
  });
  assert.equal(revoked.isError, true);
  assert.ok(JSON.stringify(revoked._meta).includes('mcp/www_authenticate'));
  assert.ok(!JSON.stringify(revoked).includes(outer));
  console.log(
    'PASS: SDK Node MCP → fixed HTTPS/TLS client → real Next authenticated gateway; canonical fixture revocation yields a linking challenge. Business RLS verified separately.'
  );
} finally {
  await client?.close().catch(() => undefined);
  await mcp?.close();
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Owned fixture may not be listening yet, or may already have exited. */
    }
    const exited = await Promise.race([
      once(child, 'exit').then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!exited) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Owned fixture may not be listening yet, or may already have exited. */
      }
    }
  }
  closeSync(log);
  rmSync(dir, { recursive: true, force: true });
}
