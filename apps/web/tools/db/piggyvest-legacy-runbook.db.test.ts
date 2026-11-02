import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the real zero-out script against a scratch Postgres cluster that holds
// minimal stand-ins for the two wallet tables. Skipped when no local Postgres
// binaries exist.
const binDir = [
  '/opt/homebrew/opt/postgresql@17/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
].find((d) => existsSync(join(d, 'initdb')));
const docs = resolve(__dirname, '../../../../docs/piggyvest-legacy-migration');
const zeroSql = readFileSync(join(docs, '02-zero-out.sql'), 'utf8');

const W1 = '00000000-0000-4000-8000-000000000001';
const W2 = '00000000-0000-4000-8000-000000000002';
const M = '00000000-0000-4000-8000-0000000000aa';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

const row = (w: string, c: string, amt: string) =>
  `('${w}','${M}','${c}',${amt},'PV-REF-${amt}')`;
const load = (rows: string[], declared: number) =>
  `INSERT INTO legacy_zero_out_declared (expected_rows) VALUES (${declared});\n` +
  (rows.length === 0
    ? ''
    : `INSERT INTO legacy_zero_out_list (wallet_id, merchant_id, customer_id, expected_balance, piggyvest_credit_reference) VALUES\n${rows.join(',\n')};`);

describe.skipIf(!binDir)('02-zero-out.sql against a scratch Postgres', () => {
  let dir = '';
  const bin = (n: string) => join(binDir as string, n);
  const psql = (sql: string, file?: string) =>
    spawnSync(
      bin('psql'),
      [
        '-h',
        dir,
        '-d',
        'scratch',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        ...(file ? ['-f', file] : ['-c', sql]),
      ],
      { encoding: 'utf8' }
    );
  const reset = (balances: [string, string][], extra = '') =>
    psql(
      `DELETE FROM customer_wallet_transactions; DELETE FROM customer_wallets;
       ${balances
         .map(
           ([w, b]) =>
             `INSERT INTO customer_wallets (id, customer_id, merchant_id, available_balance) VALUES ('${w}','${w === W1 ? C1 : C2}','${M}',${b});`
         )
         .join('\n')}
       ${extra}`
    );
  const run = (rows: string[], declared: number, commit = false) => {
    let sql = zeroSql.replace(
      '-- <<< REVIEWED ROWS ABOVE',
      `${load(rows, declared)}\n-- <<<`
    );
    if (commit) sql = sql.replace('ROLLBACK;\n-- COMMIT;', 'COMMIT;');
    const file = join(dir, 'run.sql');
    writeFileSync(file, sql);
    return psql('', file);
  };
  const balance = (w: string) =>
    psql(
      `SELECT available_balance FROM customer_wallets WHERE id='${w}'`
    ).stdout.trim();
  const ledgerRows = () =>
    psql(
      `SELECT count(*) FROM customer_wallet_transactions WHERE source_type='piggyvest_legacy_migration'`
    ).stdout.trim();

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pvlegacy-'));
    process.env.LC_ALL = 'C';
    process.env.LANG = 'C';
    execFileSync(
      bin('initdb'),
      [
        '-D',
        join(dir, 'data'),
        '-A',
        'trust',
        '-U',
        process.env.USER ?? 'postgres',
      ],
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
    execFileSync(bin('createdb'), ['-h', dir, 'scratch']);
    const ddl = `
      CREATE TABLE customer_wallets (id uuid PRIMARY KEY, customer_id uuid NOT NULL, merchant_id uuid NOT NULL,
        available_balance numeric(12,2) DEFAULT 0, updated_at timestamptz DEFAULT now());
      CREATE TABLE customer_wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL,
        customer_id uuid NOT NULL, merchant_id uuid NOT NULL, type text NOT NULL, amount numeric(10,2) NOT NULL,
        balance_after numeric(12,2) NOT NULL, source_type text, status text DEFAULT 'completed', description text,
        metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(),
        CONSTRAINT t CHECK (type = ANY (ARRAY['cashback','redemption','bonus','adjustment','expiry','credit','debit','refund'])),
        CONSTRAINT s CHECK (status = ANY (ARRAY['pending','completed','failed','expired'])));
      CREATE SCHEMA IF NOT EXISTS public;`;
    expect(psql(ddl).status).toBe(0);
  }, 60_000);

  afterAll(() => {
    if (!dir) return;
    spawnSync(bin('pg_ctl'), [
      '-D',
      join(dir, 'data'),
      '-m',
      'immediate',
      'stop',
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('zeroes listed wallets and writes one ledger row each when committed', () => {
    reset([
      [W1, '500.00'],
      [W2, '250.00'],
    ]);
    const r = run([row(W1, C1, '500.00'), row(W2, C2, '250.00')], 2, true);
    expect(r.status).toBe(0);
    expect(balance(W1)).toBe('0.00');
    expect(balance(W2)).toBe('0.00');
    expect(ledgerRows()).toBe('2');
  });

  it('changes nothing in the default dry run', () => {
    reset([[W1, '500.00']]);
    expect(run([row(W1, C1, '500.00')], 1).status).toBe(0);
    expect(balance(W1)).toBe('500.00');
    expect(ledgerRows()).toBe('0');
  });

  it('refuses a balance mismatch', () => {
    reset([[W1, '400.00']]);
    const r = run([row(W1, C1, '500.00')], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/mismatch/);
    expect(balance(W1)).toBe('400.00');
  });

  it('refuses an empty list', () => {
    reset([[W1, '500.00']]);
    const r = run([], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/list is empty/);
    expect(balance(W1)).toBe('500.00');
  });

  it('refuses a second run for a migrated wallet', () => {
    reset([[W1, '500.00']]);
    expect(run([row(W1, C1, '500.00')], 1, true).status).toBe(0);
    psql(
      `UPDATE customer_wallets SET available_balance = 500 WHERE id='${W1}'`
    );
    const r = run([row(W1, C1, '500.00')], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/already migrated/);
    expect(balance(W1)).toBe('500.00');
  });

  it('refuses a wallet with a pending ledger row', () => {
    reset(
      [[W1, '600.00']],
      `INSERT INTO customer_wallet_transactions (wallet_id, customer_id, merchant_id, type, amount, balance_after, status)
       VALUES ('${W1}','${C1}','${M}','redemption',400,600,'pending');`
    );
    const r = run([row(W1, C1, '600.00')], 1, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pending ledger row/);
    expect(balance(W1)).toBe('600.00');
    expect(ledgerRows()).toBe('0');
  });

  it('refuses a declared count that differs from the loaded rows', () => {
    reset([
      [W1, '500.00'],
      [W2, '250.00'],
    ]);
    const r = run([row(W1, C1, '500.00')], 2, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/row count mismatch/);
    expect(balance(W1)).toBe('500.00');
  });

  it('writes nothing when one row of the insert is invalid', () => {
    reset([
      [W1, '500.00'],
      [W2, '250.00'],
    ]);
    const r = run([row(W1, C1, '500.00'), row(W2, C2, '0')], 2, true);
    expect(r.status).not.toBe(0);
    expect(balance(W1)).toBe('500.00');
    expect(ledgerRows()).toBe('0');
  });
});
