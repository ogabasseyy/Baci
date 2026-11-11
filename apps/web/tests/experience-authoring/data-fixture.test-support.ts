import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { startLocalPostgrest } from '../../tools/builder-auth/local-postgrest-fixture';
import { publicationFixture } from '../../tools/builder-auth/publication-test-support';

export function localApiResponse(
  status: number,
  body: Buffer,
  rawHeaders: IncomingHttpHeaders
) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(rawHeaders))
    if (value !== undefined)
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  return new Response(
    [204, 205, 304].includes(status) ? null : new Uint8Array(body).buffer,
    {
      status,
      headers,
    }
  );
}
export async function closeAuthoringFixture(
  api: { close(): Promise<void> } | undefined,
  db: { close(): Promise<void> }
) {
  const results = await Promise.allSettled([api?.close(), db.close()]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
export async function experienceDataFixture() {
  const f = await publicationFixture({ local: true });
  let api: Awaited<ReturnType<typeof startLocalPostgrest>> | undefined;
  try {
    if (!f.localDatabase) throw Error('Disposable local PostgreSQL required');
    await f.pool.query(
      'CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz)'
    );
    await f.pool.query(
      "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS premium_features jsonb DEFAULT '[]'"
    );
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073157_experience_private_uploads.sql',
      '20261024073533_experience_job_and_draft_lifecycle.sql',
      '20261024074638_experience_private_preview.sql',
      '20261024124000_experience_public_read_projection.sql',
      '20261103203000_experience_public_manifest_order.sql',
      '20261024130000_experience_verified_snapshots.sql',
      '20261024171619_experience_owner_intents.sql',
      '20261024172102_experience_legacy_mode_guards.sql',
      '20261024180212_experience_lifecycle_foundation.sql',
      '20261024180213_experience_lifecycle_transactions.sql',
      '20261024180250_experience_mode_exit_effects.sql',
      '20261025060500_experience_upload_manifest_validation.sql',
      '20261028162326_experience_retry_build_quota.sql',
      '20261103161500_experience_https_build_origins.sql',
      '20261103195300_experience_publish_scope_authorization.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const a = randomUUID();
    const b = randomUUID();
    const m = randomUUID();
    const connection = randomUUID();
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1),($2)', [a, b]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      m,
      a,
    ]);
    await f.pool.query(
      'INSERT INTO auth.sessions(id,user_id) VALUES($1,$2),($3,$4)',
      [sessionA, a, sessionB, b]
    );
    await f.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allowed_merchant_ids,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],ARRAY[$3::uuid],now()+interval '1 hour')",
      [connection, a, m]
    );
    await f.pool.query(
      'CREATE ROLE builder_experience_fixture LOGIN NOINHERIT;GRANT anon,authenticated TO builder_experience_fixture'
    );
    const key = await generateKeyPair('ES256', { extractable: true });
    api = await startLocalPostgrest({
      databaseSocket: f.localDatabase.socketDirectory,
      role: 'builder_experience_fixture',
      jwks: {
        keys: [
          { ...(await exportJWK(key.publicKey)), kid: 'local', alg: 'ES256' },
        ],
      },
    });
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      );
      const headers = new Headers(init?.headers);
      const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      if (url.pathname === '/auth/v1/user') {
        try {
          const { payload } = await jwtVerify(token, key.publicKey, {
            audience: 'authenticated',
          });
          return Response.json({
            id: payload.sub,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'synthetic@example.test',
            created_at: new Date().toISOString(),
          });
        } catch {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
      }
      return new Promise<Response>((resolve, reject) => {
        const req = request(
          {
            socketPath: api?.socketPath,
            path: url.pathname.replace(/^\/rest\/v1/, '') + url.search,
            method: init?.method ?? 'GET',
            headers: Object.fromEntries(headers),
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              try {
                resolve(
                  localApiResponse(
                    res.statusCode ?? 502,
                    Buffer.concat(chunks),
                    res.headers
                  )
                );
              } catch (error) {
                reject(error);
              }
            });
          }
        );
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(Error('Local DataAPI timeout')));
        const body = init?.body;
        if (
          body !== undefined &&
          body !== null &&
          typeof body !== 'string' &&
          !(body instanceof Uint8Array)
        )
          throw Error('Unexpected local fixture body');
        req.end(body ?? undefined);
      });
    };
    const ctx = async (actor: string) => {
      const token = await new SignJWT({
        role: 'authenticated',
        session_id: actor === a ? sessionA : sessionB,
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'local' })
        .setAudience('authenticated')
        .setSubject(actor)
        .setExpirationTime('5m')
        .sign(key.privateKey);
      return {
        merchantId: m,
        accessToken: token,
        supabase: createClient('http://synthetic.local', 'synthetic-anon', {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            headers: { Authorization: `Bearer ${token}` },
            fetch: fetchImpl,
          },
        }),
      };
    };
    const owner = await ctx(a);
    const other = await ctx(b);
    const anonymousToken = await new SignJWT({ role: 'anon' })
      .setProtectedHeader({ alg: 'ES256', kid: 'local' })
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(key.privateKey);
    const anonymous = createClient('http://synthetic.local', 'synthetic-anon', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${anonymousToken}` },
        fetch: fetchImpl,
      },
    });
    return {
      db: f,
      owner,
      other,
      anonymous,
      merchantId: m,
      actorId: a,
      connectionId: connection,
      sessionId: sessionA,
      close: async () => {
        await closeAuthoringFixture(api, f);
      },
    };
  } catch (error) {
    await closeAuthoringFixture(api, f).catch(() => {
      console.error('Disposable authoring fixture setup cleanup failed');
    });
    throw error;
  }
}
