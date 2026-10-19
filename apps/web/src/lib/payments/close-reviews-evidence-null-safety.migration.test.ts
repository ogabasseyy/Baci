import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184400_close_reviews_evidence_null_safety.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('close reviews evidence null-safety migration', () => {
  it('blocks closure unless nested entries are objects with explicit false flags', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // A malformed value reads SQL NULL, which <> 'false' lets
    // through: null-safe comparison plus the object check keeps
    // unaudited evidence open.
    expect(migrationSql).toContain(
      "jsonb_typeof(e.value) IS DISTINCT FROM 'object' OR (e.value->>'audit_record_failed') IS DISTINCT FROM 'false'"
    );
    expect(migrationSql).toContain(
      "jsonb_typeof(e.value) IS DISTINCT FROM 'object' OR (e.value->>'ambiguous') IS DISTINCT FROM 'false'"
    );
    expect(migrationSql).not.toContain(
      "(e.value->>'audit_record_failed') <> 'false'"
    );
    expect(migrationSql).not.toContain("(e.value->>'ambiguous') <> 'false'");
  });

  it('matches audit refunds with a normalized gateway comparison', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "public.normalized_gateway_name_v1(r.gateway) = 'PAYSTACK'"
    );
    expect(migrationSql).not.toContain("AND r.gateway = 'paystack'");
  });
});
