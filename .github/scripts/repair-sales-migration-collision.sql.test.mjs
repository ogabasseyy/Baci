import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const repair = readFileSync(new URL('../../supabase/migrations/20260907111036_repair_sales_exclusion_wallet_version_collision.sql', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../supabase/migrations/20260903120000_exclude_repair_pickup_from_merchant_sales.sql', import.meta.url), 'utf8');

test('the guarded repair retains the exact reviewed sales SQL', () => {
  const body = repair.split('$sales_source$')[1];
  assert.equal(body, `\n${original}`);
});

test('PostgreSQL executes the repair only for the missing historical sales migration', () => {
  const bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  const directory = mkdtempSync(join(tmpdir(), 'sales-repair-postgres-'));
  let running = false;
  try {
    execFileSync(join(bin, 'initdb'), ['-D', `${directory}/data`, '-A', 'trust', '--no-locale', '-U', 'postgres'], { stdio: 'pipe' });
    execFileSync(join(bin, 'pg_ctl'), ['-D', `${directory}/data`, '-l', `${directory}/server.log`, '-o', `-k ${directory} -h '' -p 65439`, '-w', 'start'], { stdio: 'pipe' });
    running = true;
    const query = sql => execFileSync(join(bin, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', directory, '-p', '65439', '-U', 'postgres', '-d', 'postgres', '-qAt'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const fixture = `BEGIN;
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('20260903120000', 'guard_merchant_wallet_paystack_dva_alias');`;
    assert.equal(query(`${fixture}\n${repair}\nSELECT public.is_merchant_sales_transaction('{"transaction_type":"repair_pickup"}'), public.is_merchant_sales_transaction('{}');\nROLLBACK;`).trim(), 'f|t');
    const fresh = fixture.replace('guard_merchant_wallet_paystack_dva_alias', 'exclude_repair_pickup_from_merchant_sales');
    assert.equal(query(`${fresh}\nCREATE FUNCTION public.is_merchant_sales_transaction(jsonb) RETURNS boolean LANGUAGE sql AS 'SELECT false';\n${repair}\nSELECT public.is_merchant_sales_transaction('{}');\nROLLBACK;`).trim(), 'f');
    assert.throws(() => query(`${fixture}\nINSERT INTO supabase_migrations.schema_migrations VALUES ('20260904110100', 'exclude_repair_pickup_refunds_from_reconciliation');\n${repair}\nROLLBACK;`), /must precede refund follow-on/);
  } finally {
    if (running) execFileSync(join(bin, 'pg_ctl'), ['-D', `${directory}/data`, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
    rmSync(directory, { recursive: true, force: true });
  }
});
