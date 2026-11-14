import assert from 'node:assert/strict';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportJWK, generateKeyPair } from 'jose';
import { createAuthListener, listenPrivateAuth } from './auth-listener.ts';
import { createBuilderProvider } from './provider.ts';

test('exposes only the fixed HTTPS authority over a private socket and strips forged proxy headers', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  const socketPath = join(dir, 'broker.sock');
  const server = await createAuthListener({
    socketPath,
    authority: 'mcp.usebaci.com',
    handler: async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.headers));
    },
  });
  const send = (host: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path: '/.well-known/openid-configuration',
          headers: {
            host,
            forwarded: 'host=evil.test;proto=http',
            'x-forwarded-host': 'evil.test',
            'x-forwarded-proto': 'http',
            'x-forwarded-for': '192.0.2.5',
          },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  try {
    assert.equal((await lstat(socketPath)).mode & 0o777, 0o600);
    const good = await send('mcp.usebaci.com');
    assert.equal(good.status, 200);
    const headers = JSON.parse(good.body);
    assert.equal(headers['x-forwarded-proto'], 'https');
    assert.equal(headers['x-forwarded-host'], 'mcp.usebaci.com');
    assert.equal(headers['x-forwarded-for'], undefined);
    assert.equal(headers.forwarded, undefined);
    assert.equal((await send('evil.test')).status, 400);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a socket directory writable by other users', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  try {
    await (await import('node:fs/promises')).chmod(dir, 0o777);
    await assert.rejects(
      createAuthListener({
        socketPath: join(dir, 'broker.sock'),
        authority: 'mcp.usebaci.com',
        handler: async () => {},
      }),
      /UNTRUSTED_SOCKET_DIRECTORY/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restores provider proxy settings if listener startup fails', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  const provider = { proxy: false };
  try {
    await (await import('node:fs/promises')).chmod(dir, 0o777);
    await assert.rejects(
      listenPrivateAuth({
        socketPath: join(dir, 'broker.sock'),
        issuer: 'https://mcp.usebaci.com',
        provider,
        handler: async () => {},
      }),
      /UNTRUSTED_SOCKET_DIRECTORY/
    );
    assert.equal(provider.proxy, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a private socket directory underneath a replaceable parent', async () => {
  const outer = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  try {
    const fs = await import('node:fs/promises');
    await fs.chmod(outer, 0o777);
    const inner = join(outer, 'private');
    await fs.mkdir(inner, { mode: 0o700 });
    const result = await createAuthListener({
      socketPath: join(inner, 'broker.sock'),
      authority: 'mcp.usebaci.com',
      handler: async () => {},
    }).then(
      async (listener) => {
        await listener.close();
        return 'allowed';
      },
      (error: Error) => error.message
    );
    assert.match(result, /UNTRUSTED_SOCKET_DIRECTORY/);
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test('contains a synchronous handler failure without exposing its message', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  const socketPath = join(dir, 'broker.sock');
  const server = await createAuthListener({
    socketPath,
    authority: 'mcp.usebaci.com',
    handler: () => {
      throw Error('private credential');
    },
  });
  try {
    const result = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = request(
          { socketPath, path: '/', headers: { host: 'mcp.usebaci.com' } },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          }
        );
        req.on('error', reject);
        req.end();
      }
    );
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.body, /private credential/);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the actual provider advertises the HTTPS issuer through the private listener', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-')));
  const socketPath = join(dir, 'broker.sock');
  const keys = await generateKeyPair('ES256', { extractable: true });
  const provider = createBuilderProvider(
    {
      issuer: 'https://builder-auth.usebaci.com',
      resource: 'https://mcp.usebaci.com/builder/mcp',
      callback: 'https://chatgpt.com/approved-callback',
      clientId: 'synthetic-client',
      cookieKeys: ['fixture-cookie-key-with-more-than-32-bytes'],
      jwks: {
        keys: [
          {
            ...(await exportJWK(keys.privateKey)),
            alg: 'ES256',
            kid: 'fixture',
          },
        ],
      },
    },
    { providerAdapter: class {} } as never
  );
  assert.equal(provider.proxy, false);
  const listener = await listenPrivateAuth({
    socketPath,
    issuer: 'https://builder-auth.usebaci.com',
    provider,
    handler: async (req, res) => provider.callback()(req, res),
  });
  assert.equal(provider.proxy, true);
  try {
    const result = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = request(
          {
            socketPath,
            path: '/.well-known/openid-configuration',
            headers: {
              host: 'builder-auth.usebaci.com',
              'x-forwarded-host': 'evil.test',
              'x-forwarded-proto': 'http',
            },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          }
        );
        req.on('error', reject);
        req.end();
      }
    );
    assert.equal(result.status, 200);
    const metadata = JSON.parse(result.body);
    assert.equal(metadata.issuer, 'https://builder-auth.usebaci.com');
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    assert(metadata.code_challenge_methods_supported.includes('S256'));
    assert(metadata.token_endpoint_auth_methods_supported.includes('none'));
    assert.equal(
      new URL(metadata.authorization_endpoint).origin,
      'https://builder-auth.usebaci.com'
    );
    const params = new URLSearchParams({
      client_id: 'synthetic-client',
      redirect_uri: 'https://chatgpt.com/approved-callback',
      response_type: 'code',
      scope: 'openid',
      state: 'synthetic-state',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'plain',
      resource: 'https://mcp.usebaci.com/builder/mcp',
    });
    const errorRedirect = await new Promise<{
      status: number;
      location?: string;
    }>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path: `/auth?${params}`,
          headers: { host: 'builder-auth.usebaci.com' },
        },
        (res) => {
          res.resume();
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              location: res.headers.location,
            })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(errorRedirect.status, 303);
    const location = new URL(errorRedirect.location ?? '');
    assert.equal(location.origin, 'https://chatgpt.com');
    assert.equal(
      location.searchParams.get('iss'),
      'https://builder-auth.usebaci.com'
    );
    assert(location.searchParams.get('error'));
  } finally {
    await listener.close();
    assert.equal(provider.proxy, false);
    await rm(dir, { recursive: true, force: true });
  }
});
