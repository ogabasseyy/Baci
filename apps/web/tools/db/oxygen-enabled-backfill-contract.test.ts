import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/20261125153000_add_oxygen_enabled_feature_setting.sql'
);
const SQL_TEST_PATH = path.join(
  REPO_ROOT,
  'supabase/tests/oxygen_enabled_feature_setting.sql'
);
const SQL_CHECKS_PATH = path.join(
  REPO_ROOT,
  'apps/web/tools/db/replay-registry/20261125153000_add_oxygen_enabled_feature_setting/sql-checks.txt'
);

const EXPECTED_BACKFILL_SQL = `INSERT INTO public.merchant_feature_settings (merchant_id, oxygen_enabled)
  SELECT b.merchant_id, true
  FROM oxygen_private.runtime_bindings AS b
  WHERE b.enabled IS TRUE
    AND b.environment = 'production'
  ON CONFLICT (merchant_id) DO UPDATE
    SET oxygen_enabled = true
    WHERE public.merchant_feature_settings.oxygen_enabled IS DISTINCT FROM true;`;

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('20261125153000_add_oxygen_enabled_feature_setting backfill contract', () => {
  it('defaults oxygen_enabled to false, drops the one-time backfill helper, and matches the behavioral SQL test', async () => {
    const [sql, sqlTest, sqlChecks] = await Promise.all([
      readFile(MIGRATION_PATH, 'utf8'),
      readFile(SQL_TEST_PATH, 'utf8'),
      readFile(SQL_CHECKS_PATH, 'utf8'),
    ]);

    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS oxygen_enabled boolean NOT NULL DEFAULT false;/
    );
    expect(sql).toMatch(
      /GRANT SELECT \(oxygen_enabled\) ON TABLE public\.merchant_feature_settings\s+TO authenticated;/
    );
    expect(normalizeSql(sql)).toContain(normalizeSql(EXPECTED_BACKFILL_SQL));
    expect(normalizeSql(sqlTest)).toContain(
      normalizeSql(EXPECTED_BACKFILL_SQL)
    );
    expect(sql).toMatch(/PERFORM private\.backfill_oxygen_enabled_v1\(\);/);
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS private\.backfill_oxygen_enabled_v1\(\);/
    );
    expect(
      sql.indexOf(
        'DROP FUNCTION IF EXISTS private.backfill_oxygen_enabled_v1();'
      )
    ).toBeGreaterThan(
      sql.indexOf('PERFORM private.backfill_oxygen_enabled_v1();')
    );
    expect(sqlChecks.trim()).toBe(
      'supabase/tests/oxygen_enabled_feature_setting.sql'
    );
  });

  it('enforces oxygen_enabled in pilot availability and FOR SHARE workflow entrypoint', async () => {
    const sql = await readFile(MIGRATION_PATH, 'utf8');

    expect(sql).toMatch(/AND s\.oxygen_enabled IS TRUE/);
    expect(sql).toMatch(
      /FROM public\.merchant_feature_settings AS s\s+WHERE s\.merchant_id = v_merchant_id\s+AND s\.oxygen_enabled IS TRUE\s+FOR SHARE;/
    );
    expect(sql).toMatch(
      /RAISE EXCEPTION 'Provider connection unavailable' USING ERRCODE = '42501';/
    );
  });
});
