/** Isolated local PostgreSQL test backend; no existing cluster or Docker changes. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
export async function startLocalPostgresFixture(
  options: { binDirectory?: string; major?: 17 | 18 } = {}
) {
  const major = options.major ?? 18;
  if (options.binDirectory && !path.isAbsolute(options.binDirectory))
    throw Error('PostgreSQL binary directory must be absolute');
  const root = mkdtempSync(path.join(tmpdir(), 'baci-builder-task8-'));
  const data = path.join(root, 'data');
  const socket = path.join(root, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const command = (name: string, args: string[]) =>
    execFileSync(
      options.binDirectory ? path.join(options.binDirectory, name) : name,
      args,
      {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
  let running = false;
  let pool: Pool | undefined;
  const close = async () => {
    await pool?.end();
    if (running) {
      command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      running = false;
    }
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const version = command('postgres', ['--version']);
    if (!new RegExp(`^postgres \\(PostgreSQL\\) ${major}\\.`).test(version))
      throw Error(
        `Expected explicitly selected local PostgreSQL ${major}; pinned Supabase replay is separate.`
      );
    command('initdb', [
      '-D',
      data,
      '-U',
      'postgres',
      '-A',
      'trust',
      '--no-locale',
      '--encoding=UTF8',
      '--wal-segsize=1',
    ]);
    command('pg_ctl', [
      '-D',
      data,
      '-l',
      path.join(root, 'postgres.log'),
      '-o',
      `-k ${socket} -h '' -c shared_buffers=16MB -c max_wal_size=32MB -c min_wal_size=16MB`,
      '-w',
      'start',
    ]);
    running = true;
    const connection = { host: socket, user: 'postgres', database: 'postgres' };
    pool = new Pool(connection);
    await pool.query('SELECT 1');
    return { pool, connection, root, close };
  } catch (error) {
    await close();
    throw error;
  }
}
