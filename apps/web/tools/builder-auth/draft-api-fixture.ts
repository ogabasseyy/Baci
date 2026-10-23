/** Loopback-only Data API plus cryptographically verified mock Auth /user endpoint.
 * Actual upstream Supabase Auth lifecycle is covered separately by Task 3 fixtures.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, request as proxyRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { urlToHttpOptions } from 'node:url';
import { importJWK, type JWK, jwtVerify } from 'jose';
import { startLocalPostgrest } from './local-postgrest-fixture.ts';
export async function startDraftApi(
  containerName: string,
  jwk: JWK,
  createRole: () => Promise<unknown>,
  localDatabase?: { socketDirectory: string }
) {
  const api = `baci-builder-draft-rest-${randomUUID().slice(0, 8)}`;
  const docker = (...args: string[]) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const key = await importJWK(jwk, 'ES256');
  const server = createServer(async (req, res) => {
    if (req.url === '/auth/v1/user') {
      try {
        const token = req.headers.authorization?.slice(7);
        if (!token) throw new Error('Unauthorized');
        const { payload } = await jwtVerify(token, key, {
          audience: 'authenticated',
          algorithms: ['ES256'],
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: payload.sub,
            email: payload.email,
            role: 'authenticated',
          })
        );
      } catch {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Unauthorized' }));
      }
      return;
    }
    if (!req.url?.startsWith('/rest/v1/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const proxy = proxyRequest(
      {
        ...(localApi
          ? {
              socketPath: localApi.socketPath,
              path: req.url.slice('/rest/v1'.length),
            }
          : urlToHttpOptions(
              new URL(`http://${address}${req.url.slice('/rest/v1'.length)}`)
            )),
        method: req.method,
        headers: req.headers,
      },
      (result) => {
        res.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(res);
      }
    );
    proxy.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(proxy);
  });
  let address = '';
  let localApi: Awaited<ReturnType<typeof startLocalPostgrest>> | undefined;
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      if (localApi) await localApi.close();
      else docker('rm', '-f', api);
    } catch {
      /* own fixture */
    }
  };
  try {
    await createRole();
    if (localDatabase) {
      localApi = await startLocalPostgrest({
        databaseSocket: localDatabase.socketDirectory,
        role: 'builder_draft_rest_fixture',
        jwks: { keys: [jwk] },
      });
    } else {
      const ip = docker(
        'inspect',
        containerName,
        '--format',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
      );
      docker(
        'run',
        '--rm',
        '-d',
        '--name',
        api,
        '-p',
        '127.0.0.1::3000',
        '-e',
        `PGRST_DB_URI=postgres://builder_draft_rest_fixture@${ip}:5432/postgres`,
        '-e',
        'PGRST_DB_ANON_ROLE=anon',
        '-e',
        'PGRST_DB_SCHEMAS=public',
        '-e',
        'PGRST_JWT_AUD=authenticated',
        '-e',
        `PGRST_JWT_SECRET=${JSON.stringify({ keys: [jwk] })}`,
        'postgrest/postgrest@sha256:85258123312dc496ad4c2ed832154a65e9746f84df0d6d09b44229ff9230c08e'
      );
      address = docker('port', api, '3000/tcp');
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          const r = await fetch(`http://${address}/`, {
            signal: AbortSignal.timeout(1000),
          });
          if (r.status < 500) {
            ready = true;
            break;
          }
        } catch {
          /* startup */
        }
        await delay(100);
      }
      if (!ready) throw new Error('Local Data API readiness failed');
    }
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const bound = server.address();
    if (!bound || typeof bound === 'string')
      throw new Error('Local listener unavailable');
    return { url: `http://127.0.0.1:${bound.port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
