/** Isolated local PostgreSQL test backend; no existing cluster or Docker changes. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
export async function startLocalPostgresFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'baci-builder-task8-'));
  const data = path.join(root, 'data');
  const socket = path.join(root, 'socket');
  mkdirSync(socket, { mode: 0o700 });
  const command = (name: string, args: string[]) =>
    execFileSync(name, args, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
    if (!/^postgres \(PostgreSQL\) 18\./.test(version))
      throw Error(
        'Expected explicitly tested local PostgreSQL 18; pinned PostgreSQL17 replay is separate.'
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
