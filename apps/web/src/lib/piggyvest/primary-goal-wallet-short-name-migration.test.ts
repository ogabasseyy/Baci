import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CI-run guard for the one-time rename in migration 20261031220000. The
 * seeded end-to-end check lives in primary-savings-provisioning-reclaim.
 * integration.sql, which only runs with BACI_PRIMARY_WALLET_SQL_TESTS.
 */
const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../supabase/migrations/20261031220000_piggyvest_primary_goal_wallet_short_name.sql'
  ),
  'utf8'
);

const TRIGGER = 'primary_goal_wallet_choice_immutable';
const NEW_NAME =
  "'baci-save-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(";

function renameViolations(sql: string): string[] {
  const flat = sql.replace(/\s+/g, ' ');
  const disable = flat.indexOf(
    `ALTER TABLE piggyvest_primary.goal_wallet_intents DISABLE TRIGGER ${TRIGGER};`
  );
  const enable = flat.indexOf(
    `ALTER TABLE piggyvest_primary.goal_wallet_intents ENABLE TRIGGER ${TRIGGER};`
  );
  const commit = flat.lastIndexOf('COMMIT;');
  if (disable < 0) return ['the trigger is never disabled'];
  if (enable < disable)
    return ['the trigger is not re-enabled after the rename'];
  if (commit < enable)
    return ['the trigger is re-enabled outside the transaction'];
  const between = flat
    .slice(disable, enable)
    .split(';')
    .slice(1)
    .map((statement) => statement.trim())
    .filter(Boolean);
  const violations: string[] = [];
  if (between.length !== 1 || !between[0].startsWith('UPDATE '))
    violations.push('exactly one UPDATE must run while the trigger is off');
  const update = between[0] ?? '';
  for (const required of [
    'UPDATE piggyvest_primary.goal_wallet_intents SET wallet_name = ',
    NEW_NAME,
    "integration_id::text || ':' || goal_id::text, 'UTF8')), 'hex'), 1, 32)",
    "WHERE state IN ('dispatched','unknown')",
    'AND provider_wallet_id IS NULL',
    "AND pg_catalog.lower(wallet_name) = 'baci-save:' || integration_id::text || ':' || goal_id::text",
  ]) {
    if (!update.includes(required)) violations.push(`missing: ${required}`);
  }
  // Only the name changes: no lease reset, no state or wallet rewrite.
  const setClause = update.slice(
    update.indexOf(' SET '),
    update.indexOf(' WHERE ')
  );
  if (/updated_at|state\s*=|provider_wallet_id\s*=|claim_token/.test(setClause))
    violations.push('the rename must change wallet_name only');
  return violations;
}

describe('20261031220000 one-time goal wallet rename', () => {
  it('renames only wallet-less old-name intents, case-insensitively, inside one guarded statement', () => {
    expect(renameViolations(migrationSql)).toEqual([]);
  });

  it('builds the same name as prepare_goal_wallet', () => {
    const flat = migrationSql.replace(/\s+/g, ' ');
    expect(flat).toContain(
      `name text := ${NEW_NAME} (scope->>'integrationId')::uuid::text || ':' || selected_goal::text, 'UTF8')), 'hex'), 1, 32);`
    );
  });

  it.each([
    [
      'the rename is removed',
      (sql: string) =>
        sql.replace(
          /UPDATE piggyvest_primary\.goal_wallet_intents\s+SET wallet_name[\s\S]*?;\n/,
          ''
        ),
    ],
    [
      'unknown intents are dropped',
      (sql: string) =>
        sql.replace("('dispatched','unknown')", "('dispatched')"),
    ],
    [
      'the match is case-sensitive',
      (sql: string) =>
        sql.replace('pg_catalog.lower(wallet_name)', 'wallet_name'),
    ],
    [
      'wallet-bound intents are included',
      (sql: string) => sql.replace('AND provider_wallet_id IS NULL', ''),
    ],
    [
      'the trigger stays disabled',
      (sql: string) =>
        sql.replace(
          /ALTER TABLE piggyvest_primary\.goal_wallet_intents\s+ENABLE TRIGGER[^;]*;/,
          ''
        ),
    ],
    [
      'the lease is reset',
      (sql: string) =>
        sql.replace(
          'SET wallet_name =',
          'SET updated_at = now(), wallet_name ='
        ),
    ],
  ])('flags a migration where %s', (_label, mutate) => {
    expect(renameViolations(mutate(migrationSql))).not.toEqual([]);
  });
});
