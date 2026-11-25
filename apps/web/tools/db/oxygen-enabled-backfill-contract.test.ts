import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'supabase/migrations/20261125153000_add_oxygen_enabled_feature_setting.sql'
);
const SQL_CHECKS_PATH = path.join(
  REPO_ROOT,
  'apps/web/tools/db/replay-registry/20261125153000_add_oxygen_enabled_feature_setting/sql-checks.txt'
);

describe('20261125153000_add_oxygen_enabled_feature_setting backfill contract', () => {
  it('defaults oxygen_enabled to false, confines backfill helper to service_role, and exercises it in sql-checks', async () => {
    const [sql, sqlChecks] = await Promise.all([
      readFile(MIGRATION_PATH, 'utf8'),
      readFile(SQL_CHECKS_PATH, 'utf8'),
    ]);

    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS oxygen_enabled boolean NOT NULL DEFAULT false;/
    );
    expect(sql).toMatch(
      /GRANT SELECT \(oxygen_enabled\) ON TABLE public\.merchant_feature_settings\s+TO authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION private\.backfill_oxygen_enabled_v1\(\) FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION private\.backfill_oxygen_enabled_v1\(\) TO service_role;/
    );
    expect(sql).toMatch(/PERFORM private\.backfill_oxygen_enabled_v1\(\);/);
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
