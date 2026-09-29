import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928173000_stamp_wedge_sweep_resolution.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('stamp wedge sweep resolution migration', () => {
  it('merges the wedge resolution database-side instead of spreading stale metadata', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.stamp_wedge_sweep_resolution_v1('
    );
    // Atomic JSONB merge: a client-side spread would clobber a concurrent
    // completion and erase the abandoned_sweep_resolution stamp.
    expect(migrationSql).toContain(
      "coalesce(metadata, '{}'::jsonb) || jsonb_build_object("
    );
    expect(migrationSql).toContain("'wedge_sweep_resolution', p_resolution");
    expect(migrationSql).toContain("'wedge_sweep_resolved_at'");
    expect(migrationSql).toContain(
      "metadata->>'wedge_sweep_resolution' IS NULL"
    );
    expect(migrationSql).toContain(
      "(SELECT auth.role()) IS DISTINCT FROM 'service_role'"
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.stamp_wedge_sweep_resolution_v1(uuid, text)'
    );
  });
});
