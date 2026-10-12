import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statfsSync,
} from 'node:fs';
import { join } from 'node:path';
import { bindSql } from './bind-sql.mjs';
import { CONTRACT_E2E } from './constants.mjs';

export function createDisposablePostgres() {
  const available = statfsSync('/private/tmp');
  if (available.bavail * available.bsize < 128 * 1024 * 1024)
    throw new Error('Disposable PostgreSQL requires 128 MiB free');
  const directory = realpathSync(
    mkdtempSync('/private/tmp/baci-contract-e2e-')
  );
  const data = join(directory, 'data');
  const environment = {
    PATH: '/opt/homebrew/bin:/usr/bin:/bin',
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
    HOME: directory,
  };
  let running = false;

  function command(binary, args, input) {
    try {
      return execFileSync(join(CONTRACT_E2E.postgresBin, binary), args, {
        env: environment,
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
      }).trim();
    } catch {
      throw new Error(
        `Disposable PostgreSQL ${binary} failed; output withheld`
      );
    }
  }

  function start() {
    command('pg_ctl', [
      '-D',
      data,
      '-l',
      join(directory, 'postgres.log'),
      '-o',
      `-k ${directory} -h '' -p ${CONTRACT_E2E.port} -c shared_buffers=8MB -c max_connections=12 -c max_wal_size=16MB -c min_wal_size=2MB -c autovacuum=off -c log_min_messages=panic -c log_min_error_statement=panic -c log_error_verbosity=terse`,
      '-w',
      'start',
    ]);
    running = true;
  }

  function sql(query, role = 'supabase_admin', variables = {}) {
    if (!running) throw new Error('Disposable PostgreSQL is not running');
    const args = [
      '-X',
      '-w',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      directory,
      '-p',
      CONTRACT_E2E.port,
      '-U',
      role,
      '-d',
      'postgres',
    ];
    for (const [key, value] of Object.entries(variables))
      args.push('-v', `${key}=${value}`);
    return command('psql', args, query);
  }

  function stop() {
    if (!running && !existsSync(join(data, 'postmaster.pid'))) return;
    const pidFile = readFileSync(join(data, 'postmaster.pid'), 'utf8');
    if (pidFile.split('\n')[1] !== data)
      throw new Error('Disposable PostgreSQL ownership mismatch');
    command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    running = false;
  }

  try {
    command('initdb', [
      '-D',
      data,
      '-A',
      'trust',
      '-U',
      'supabase_admin',
      '--no-locale',
      '--encoding=UTF8',
      '--wal-segsize=1',
      '--no-sync',
    ]);
    start();
  } catch (error) {
    stop();
    rmSync(directory, { recursive: true });
    throw error;
  }

  return {
    directory,
    sql,
    async execute(statement, parameters, role, sessionRole) {
      const bound = bindSql(statement, parameters);
      if (!running) throw new Error('Disposable PostgreSQL is not running');
      if (
        sessionRole !== undefined &&
        !['pvb_staging_ingest', 'pvb_staging_worker', 'authenticated'].includes(
          sessionRole
        )
      )
        throw new Error('Disposable session role refused');
      const query = `${sessionRole ? `BEGIN; SET LOCAL ROLE ${sessionRole};` : ''}
        SELECT coalesce(json_agg(contract_row),'[]'::json) FROM (${bound}) contract_row;
        ${sessionRole ? 'COMMIT;' : ''}`;
      const result = await new Promise((resolveResult, rejectResult) => {
        const child = execFile(
          join(CONTRACT_E2E.postgresBin, 'psql'),
          [
            '-X',
            '-w',
            '-qAt',
            '-v',
            'ON_ERROR_STOP=1',
            '-h',
            directory,
            '-p',
            CONTRACT_E2E.port,
            '-U',
            role,
            '-d',
            'postgres',
          ],
          {
            env: environment,
            encoding: 'utf8',
            timeout: 30000,
            maxBuffer: 4 * 1024 * 1024,
          },
          (error, stdout) => {
            if (error)
              rejectResult(
                new Error('Disposable PostgreSQL psql failed; output withheld')
              );
            else resolveResult(stdout.trim());
          }
        );
        child.stdin.end(query);
      });
      return { rows: JSON.parse(result) };
    },
    restart() {
      stop();
      start();
    },
    close() {
      stop();
      rmSync(directory, { recursive: true });
    },
  };
}
