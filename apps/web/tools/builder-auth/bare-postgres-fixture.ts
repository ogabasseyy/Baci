/** Empty, isolated PostgreSQL for tests that exercise database role creation. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { builderCiDockerArgs } from './ci-container-labels.mjs';
import { startLocalPostgresFixture } from './local-postgres-fixture.ts';

export async function startBarePostgresFixture() {
  if (process.env.BACI_BUILDER_LOCAL_PG === '1') {
    const major = process.env.BACI_BUILDER_LOCAL_PG_MAJOR;
    if (major !== undefined && major !== '17' && major !== '18')
      throw Error('Unsupported local PostgreSQL major');
    return startLocalPostgresFixture({
      major: major === '17' ? 17 : 18,
      binDirectory: process.env.BACI_BUILDER_LOCAL_PG_BIN,
    });
  }
  const name = `baci-builder-auth-${randomUUID().slice(0, 8)}`;
  const docker = (...args: string[]) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  let pool: Pool | undefined;
  const close = async () => {
    await pool?.end();
    try {
      docker('rm', '-f', name);
    } catch {
      /* owned cleanup */
    }
  };
  try {
    docker(
      'run',
      '--rm',
      '-d',
      ...builderCiDockerArgs(),
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
        docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) throw Error('Database not ready');
    const port = Number(docker('port', name, '5432/tcp').split(':').at(-1));
    const connection = {
      host: '127.0.0.1',
      port,
      user: 'postgres',
      database: 'postgres',
    };
    pool = new Pool(connection);
    await pool.query('SELECT 1');
    return { pool, connection, close };
  } catch (error) {
    await close();
    throw error;
  }
}
