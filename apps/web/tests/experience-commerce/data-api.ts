/** Owned loopback Data API; only disposable roles and synthetic auth. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, request } from 'node:http';
import type { Pool } from 'pg';
import { startLocalPostgrest } from '../../tools/builder-auth/local-postgrest-fixture.ts';
export function failCommerceUpstream(res: {
  readonly headersSent: boolean;
  writeHead: (status: number) => unknown;
  end: () => unknown;
  destroy: () => unknown;
}) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(503);
  res.end();
}
export async function startCommerceDataApi(f: {
  pool: Pool;
  connection: { host: string };
}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const kid = randomUUID();
  const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  const privateJwk = {
    ...privateKey.export({ format: 'jwk' }),
    kid,
    alg: 'ES256',
    use: 'sig',
  };
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      role: 'anon',
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const anonKey = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  await f.pool.query(
    'CREATE ROLE builder_experience_api_fixture LOGIN NOINHERIT; GRANT anon,authenticated,commerce_cart_shopper,commerce_cart_revoker,commerce_cart_receiver,commerce_cart_account_linker TO builder_experience_api_fixture'
  );
  const rest = await startLocalPostgrest({
    databaseSocket: f.connection.host,
    role: 'builder_experience_api_fixture',
    jwks: { keys: [publicJwk] },
    diagnose: (status, body) => {
      if (status >= 500)
        process.stderr.write(`LOCAL_DATA_API ${status} ${body}\n`);
    },
  });
  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (
      origin &&
      (origin === 'https://synthetic.synthetic.test' ||
        /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
    )
      res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,x-supabase-api-version'
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url?.startsWith('/auth/v1/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          code: 'bad_jwt',
          message: 'Synthetic fixture has no customer session',
        })
      );
      return;
    }
    if (!req.url?.startsWith('/rest/v1/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.apikey;
    const upstream = request(
      {
        socketPath: rest.socketPath,
        path: req.url.slice('/rest/v1'.length),
        method: req.method,
        headers,
      },
      (reply) => {
        const responseHeaders = { ...reply.headers };
        for (const name of Object.keys(responseHeaders)) {
          if (name.startsWith('access-control-')) delete responseHeaders[name];
        }
        res.writeHead(reply.statusCode ?? 502, responseHeaders);
        reply.pipe(res);
      }
    );
    upstream.setTimeout(5000, () =>
      upstream.destroy(Error('LOCAL_API_TIMEOUT'))
    );
    upstream.on('error', () => failCommerceUpstream(res));
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  return {
    url: `http://127.0.0.1:${address.port}`,
    anonKey,
    privateJwk,
    ownerToken(owner: string, session: string) {
      const payload = Buffer.from(
        JSON.stringify({
          sub: owner,
          session_id: session,
          role: 'authenticated',
          aud: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const unsigned = `${header}.${payload}`;
      return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rest.close();
    },
  };
}
