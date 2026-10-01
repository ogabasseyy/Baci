import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183500_duplicate_capture_review_pending_marker.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('duplicate capture review pending marker migration', () => {
  it('sets and clears the retry marker database-side without clobbering metadata', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.set_duplicate_capture_review_pending_v1('
    );
    expect(migrationSql).toContain('p_transaction_id uuid, p_pending boolean');
    // Atomic JSONB merge: a client-side spread would clobber a
    // concurrently completed payment's metadata.
    expect(migrationSql).toContain(
      "coalesce(metadata, '{}'::jsonb) || jsonb_build_object("
    );
    expect(migrationSql).toContain("'duplicate_capture_review_pending', true");
    expect(migrationSql).toContain(
      "coalesce(metadata, '{}'::jsonb) - 'duplicate_capture_review_pending'"
    );
    expect(migrationSql).toContain("AND transaction_type = 'payment'");
    expect(migrationSql).toContain(
      "(SELECT auth.role()) IS DISTINCT FROM 'service_role'"
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.set_duplicate_capture_review_pending_v1(uuid, boolean)'
    );
  });
});
