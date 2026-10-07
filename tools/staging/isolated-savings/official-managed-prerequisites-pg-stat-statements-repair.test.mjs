import assert from 'node:assert/strict';
import test from 'node:test';
import { officialManagedPgStatStatementsRepair } from './official-managed-prerequisites-pg-stat-statements-repair.mjs';

test('rejects absent or injectable cluster identities before rendering SQL', () => {
  for (const identifier of [undefined, '', 'postgres', "1'; COMMIT; --", 123]) {
    assert.throws(() => officialManagedPgStatStatementsRepair(identifier));
  }
});

test('repairs the missing packaged extension rather than fabricating its view', () => {
  const sql = officialManagedPgStatStatementsRepair('1111111111111111111');
  assert.ok(
    sql.includes(
      "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions VERSION '1.11'"
    )
  );
  assert.ok(sql.includes("dependency.deptype = 'e'"));
  assert.doesNotMatch(sql, /CREATE(?: OR REPLACE)? VIEW/i);
  assert.doesNotMatch(sql, /DROP (?:SCHEMA|TABLE|EXTENSION)/i);
});

test('requires persistent containment and empty application state before installation', () => {
  const sql = officialManagedPgStatStatementsRepair('1111111111111111111');
  const create = sql.indexOf(
    'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
  );
  for (const guard of [
    "current_database() <> 'postgres'",
    'inet_client_addr() IS NOT NULL',
  ]) {
    assert.ok(sql.indexOf(guard) >= 0 && sql.indexOf(guard) < create);
  }
  assert.ok(
    sql.includes('Statistics repair requires rolled-back empty Baci schema')
  );
  assert.ok(sql.includes("reset_val = 'none'"));
  assert.ok(sql.includes("reset_val = 'off'"));
  assert.ok(sql.includes("evtenabled<>'D'"));
});

test('checks managed data and role preservation before committing', () => {
  const sql = officialManagedPgStatStatementsRepair('1111111111111111111');
  assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\nBEGIN;'));
  assert.ok(sql.includes('pg_temp.managed_preserved_state() IS DISTINCT FROM'));
  assert.ok(
    sql.indexOf('Auth, Storage or existing roles changed') <
      sql.indexOf('\nCOMMIT;')
  );
});
