import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182900_file_recovery_review_preserve_markers.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('recovery-review marker preservation migration', () => {
  it('OR-preserves audit markers across merges', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.file_paystack_refund_recovery_review_v1('
    );
    // The merge kept only refund_evidence: a reference-only merge
    // into an open review dropped the top-level markers, letting
    // aggregate finalization resolve the review on another refund's
    // coverage even though the event can never tie to a recorded row.
    expect(migrationSql).toContain("'audit_record_failed'");
    expect(migrationSql).toContain("'reference_only_refund_event'");
    // OR, never overwrite: a marker once raised stays until
    // operations resolves the review.
    expect(migrationSql).toContain(
      "(v_metadata->>'audit_record_failed')::boolean, false) OR"
    );
    expect(migrationSql).toContain(
      "(v_metadata->>'reference_only_refund_event')::boolean, false ) OR"
    );
  });
});
