import {
  execFileSync,
  type SpawnSyncReturns,
  spawn,
  spawnSync,
} from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

// Shared scratch-Postgres helpers for the PiggyVest legacy runbook DB tests.
// Binaries are found through PG_BIN, then PATH, then the usual install
// folders for any major version.
const findBinDir = (): string | undefined => {
  const roots = ['/opt/homebrew/opt', '/usr/local/opt'];
  const versioned = [
    ...roots.flatMap((r) =>
      existsSync(r)
        ? readdirSync(r)
            .filter((n) => n.startsWith('postgresql'))
            .map((n) => join(r, n, 'bin'))
        : []
    ),
    ...(existsSync('/usr/lib/postgresql')
      ? readdirSync('/usr/lib/postgresql').map((v) =>
          join('/usr/lib/postgresql', v, 'bin')
        )
      : []),
  ];
  const onPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((d) => d.length > 0);
  return [process.env.PG_BIN, ...onPath, ...versioned].find(
    (d): d is string => !!d && existsSync(join(d, 'initdb'))
  );
};

export const binDir = findBinDir();
if (!binDir && process.env.REQUIRE_PG_TESTS === '1') {
  throw new Error(
    'REQUIRE_PG_TESTS=1 but no PostgreSQL binaries were found (set PG_BIN)'
  );
}
if (!binDir) {
  console.warn(
    'piggyvest-legacy-runbook.db tests: no PostgreSQL binaries found (set PG_BIN); real-database tests are SKIPPED'
  );
}

export const docsDir = resolve(
  __dirname,
  '../../../../docs/piggyvest-legacy-migration'
);

export const W1 = '00000000-0000-4000-8000-000000000001';
export const W2 = '00000000-0000-4000-8000-000000000002';
export const W3 = '00000000-0000-4000-8000-000000000003';
export const W4 = '00000000-0000-4000-8000-000000000004';
export const M = '00000000-0000-4000-8000-0000000000aa';
export const C1 = '00000000-0000-4000-8000-0000000000c1';
export const C2 = '00000000-0000-4000-8000-0000000000c2';

// The scratch schema is a deliberately loose stand-in. It has none of the
// production foreign keys, the wallet total_earned/total_redeemed columns, the
// wallet uniqueness rules or the ledger triggers (for example the AFTER INSERT
// refund-status sync). These tests prove the SQL logic of the two runbook
// scripts, not production constraint or trigger behaviour; the owner's dry run
// (ROLLBACK first) is what exercises the real schema.
const DDL = `
  CREATE TABLE customer_wallets (id uuid PRIMARY KEY, customer_id uuid NOT NULL, merchant_id uuid NOT NULL,
    available_balance numeric(12,2) DEFAULT 0, updated_at timestamptz DEFAULT now());
  CREATE TABLE customer_wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL,
    customer_id uuid NOT NULL, merchant_id uuid NOT NULL, type text NOT NULL, amount numeric(10,2) NOT NULL,
    balance_after numeric(12,2) NOT NULL, source_type text, status text DEFAULT 'completed', description text,
    metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(),
    CONSTRAINT t CHECK (type = ANY (ARRAY['cashback','redemption','bonus','adjustment','expiry','credit','debit','refund'])),
    CONSTRAINT s CHECK (status = ANY (ARRAY['pending','completed','failed','expired'])));
  CREATE TABLE customers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, full_name text, email text, phone text);
  CREATE SCHEMA IF NOT EXISTS public;`;

export type AsyncResult = { status: number | null; stderr: string };

export type Scratch = {
  dir: string;
  psql: (
    sql: string,
    file?: string,
    vars?: string[]
  ) => SpawnSyncReturns<string>;
  // Runs a SQL file without blocking, so two sessions can overlap.
  psqlFileAsync: (file: string, vars?: string[]) => Promise<AsyncResult>;
  stop: () => void;
};

export const startScratch = (): Scratch => {
  if (!binDir) {
    throw new Error(
      'startScratch requires PostgreSQL binaries; set PG_BIN or install PostgreSQL'
    );
  }
  const pgDir = binDir;
  const bin = (n: string) => join(pgDir, n);
  const dir = mkdtempSync(join(tmpdir(), 'pvlegacy-'));
  process.env.LC_ALL = 'C';
  process.env.LANG = 'C';
  const role = process.env.PGUSER || process.env.USER || 'postgres';
  const stop = () => {
    spawnSync(bin('pg_ctl'), [
      '-D',
      join(dir, 'data'),
      '-m',
      'immediate',
      'stop',
    ]);
    rmSync(dir, { recursive: true, force: true });
  };
  const psql = (sql: string, file?: string, vars: string[] = []) =>
    spawnSync(
      bin('psql'),
      [
        '-h',
        dir,
        '-U',
        role,
        '-d',
        'scratch',
        '-v',
        'ON_ERROR_STOP=1',
        ...vars.flatMap((v) => ['-v', v]),
        '-At',
        ...(file ? ['-f', file] : ['-c', sql]),
      ],
      { encoding: 'utf8' }
    );
  const psqlFileAsync = (file: string, vars: string[] = []) =>
    new Promise<AsyncResult>((done) => {
      const child = spawn(
        bin('psql'),
        [
          '-h',
          dir,
          '-U',
          role,
          '-d',
          'scratch',
          '-v',
          'ON_ERROR_STOP=1',
          ...vars.flatMap((v) => ['-v', v]),
          '-At',
          '-f',
          file,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('close', (status) => done({ status, stderr }));
    });
  try {
    execFileSync(
      bin('initdb'),
      ['-D', join(dir, 'data'), '-A', 'trust', '-U', role],
      { stdio: 'ignore' }
    );
    execFileSync(
      bin('pg_ctl'),
      [
        '-D',
        join(dir, 'data'),
        '-o',
        `-c listen_addresses='' -k ${dir}`,
        '-w',
        '-l',
        join(dir, 'log'),
        'start',
      ],
      { stdio: 'ignore' }
    );
    execFileSync(bin('createdb'), ['-h', dir, '-U', role, 'scratch']);
  } catch (error) {
    stop();
    throw error;
  }
  const ddl = psql(DDL);
  if (ddl.status !== 0) {
    stop();
    throw new Error(`scratch DDL failed: ${ddl.stderr}`);
  }
  return { dir, psql, psqlFileAsync, stop };
};
