/** Local test infrastructure; no deployed endpoint/credentials. */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolConfig } from 'pg';
import { startLocalPostgresFixture } from './local-postgres-fixture.ts';
import { createOpaqueVault } from './opaque-vault.ts';
import { createSessionVault } from './session-vault.ts';
import { createAuthStorage } from './storage.ts';
export async function databaseFixture(options: { local?: boolean } = {}) {
  let local: Awaited<ReturnType<typeof startLocalPostgresFixture>> | undefined;
  const name = `baci-builder-auth-${randomUUID().slice(0, 8)}`;
  const docker = (...args: string[]) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  let pool: Pool | undefined;
  let providerPool: Pool | undefined;
  const close = async () => {
    await providerPool?.end();
    await pool?.end();
    if (local) {
      await local.close();
      return;
    }
    try {
      docker('rm', '-f', name);
    } catch {
      /* owned cleanup */
    }
  };
  try {
    let connection: PoolConfig;
    if (options.local ?? process.env.BACI_BUILDER_LOCAL_PG === '1') {
      const major = process.env.BACI_BUILDER_LOCAL_PG_MAJOR;
      if (major !== undefined && major !== '17' && major !== '18')
        throw Error('Unsupported local PostgreSQL major');
      local = await startLocalPostgresFixture({
        binDirectory: process.env.BACI_BUILDER_LOCAL_PG_BIN,
        major: major === '17' ? 17 : 18,
      });
      connection = local.connection;
    } else {
      docker(
        'run',
        '--rm',
        '-d',
        '--name',
        name,
        '-p',
        '127.0.0.1::5432',
        '-e',
        'POSTGRES_HOST_AUTH_METHOD=trust',
        'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
      );
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          docker(
            'exec',
            name,
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'postgres'
          );
          ready = true;
          break;
        } catch {
          await delay(100);
        }
      }
      if (!ready) throw new Error('Database not ready');
      const port = Number(docker('port', name, '5432/tcp').split(':').at(-1));
      connection = {
        host: '127.0.0.1',
        port,
        user: 'postgres',
        database: 'postgres',
      };
    }
    pool = new Pool(connection);
    await pool.query(
      `CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT COALESCE(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;GRANT USAGE ON SCHEMA auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid);ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;CREATE POLICY owner ON public.merchants TO authenticated USING(user_id=auth.uid());GRANT SELECT ON public.merchants TO authenticated;`
    );
    await pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261022062133_builder_oauth_connections.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    providerPool = new Pool({
      ...connection,
      options: '-c role=baci_builder_auth_storage',
      max: 8,
    });
    const keys = new Map([['fixture', randomBytes(32)]]);
    return {
      localDatabase: local
        ? { socketDirectory: local.connection.host }
        : undefined,
      pool,
      containerName: name,
      providerPool,
      storage: createAuthStorage(
        providerPool,
        createSessionVault({ activeKeyId: 'fixture', keys }),
        createOpaqueVault('fixture', keys)
      ),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
