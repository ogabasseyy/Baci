import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { startLocalPostgrest } from '../../tools/builder-auth/local-postgrest-fixture';
import { localApiResponse } from '../experience-authoring/data-fixture.test-support';
import type { lifecycleFixture } from './sql.test-support';
export async function lifecycleDataClient(
  f: Awaited<ReturnType<typeof lifecycleFixture>>
) {
  if (!f.localDatabase) throw Error('Disposable database required');
  const session = randomUUID();
  await f.pool.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)', [
    session,
    f.actor,
  ]);
  await f.pool.query(
    'CREATE ROLE builder_lifecycle_fixture LOGIN NOINHERIT;GRANT anon,authenticated TO builder_lifecycle_fixture'
  );
  const key = await generateKeyPair('ES256', { extractable: true });
  const api = await startLocalPostgrest({
    databaseSocket: f.localDatabase.socketDirectory,
    role: 'builder_lifecycle_fixture',
    jwks: {
      keys: [
        { ...(await exportJWK(key.publicKey)), kid: 'local', alg: 'ES256' },
      ],
    },
  });
  const token = await new SignJWT({
    role: 'authenticated',
    session_id: session,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'local' })
    .setAudience('authenticated')
    .setSubject(f.actor)
    .setExpirationTime('30m')
    .sign(key.privateKey);
  const fetchImpl: typeof fetch = async (input, init) => {
    const u = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    if (u.origin !== 'http://synthetic.local')
      throw Error('NONLOCAL_FETCH_DENIED');
    const headers = new Headers(init?.headers);
    if (u.pathname === '/auth/v1/user') {
      try {
        const t = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
        const p = await jwtVerify(t, key.publicKey, {
          audience: 'authenticated',
        });
        if (p.payload.sub !== f.actor) throw Error();
        return Response.json({
          id: f.actor,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'synthetic@example.test',
          created_at: new Date().toISOString(),
        });
      } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: api.socketPath,
          path: u.pathname.replace(/^\/rest\/v1/, '') + u.search,
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(headers),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve(
              localApiResponse(
                res.statusCode ?? 502,
                Buffer.concat(chunks),
                res.headers
              )
            )
          );
        }
      );
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(Error('Local DataAPI timeout')));
      const body = init?.body;
      if (
        body !== undefined &&
        body !== null &&
        typeof body !== 'string' &&
        !(body instanceof Uint8Array)
      )
        throw Error('Invalid fixture body');
      req.end(body ?? undefined);
    });
  };
  const client = createClient('http://synthetic.local', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchImpl },
  });
  return { client, close: () => api.close() };
}
