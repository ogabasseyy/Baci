import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928181000_paystack_refund_evidence_invalid_review.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('invalid refund-evidence review migration', () => {
  it('admits the generic wedge issue type', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain("'paystack_refund_evidence_invalid'");
    expect(migrationSql).toContain(
      'VALIDATE CONSTRAINT reconciliation_review_issue_type_check'
    );
  });

  it('merges redelivered evidence under the reference lock', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The generic review has no order to key on: the merge targets the
    // open reference-keyed row and locks it, so concurrent webhooks
    // cannot clobber each other's malformed evidence.
    expect(migrationSql).toContain(
      'CREATE FUNCTION public.merge_paystack_refund_evidence_invalid_v1('
    );
    expect(migrationSql).toContain(
      "issue_type = 'paystack_refund_evidence_invalid'"
    );
    expect(migrationSql).toContain('FOR UPDATE');
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.merge_paystack_refund_evidence_invalid_v1(text,text,jsonb) TO service_role;'
    );
  });
});
