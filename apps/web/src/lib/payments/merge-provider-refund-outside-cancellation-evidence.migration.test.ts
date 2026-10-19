import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928171000_merge_provider_refund_outside_cancellation_evidence.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('merge provider refund outside cancellation evidence migration', () => {
  it('merges provider-keyed evidence into the open order review', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.merge_provider_refund_outside_cancellation_evidence_v1('
    );
    expect(migrationSql).toContain(
      "WHERE issue_type = 'provider_refund_outside_cancellation'"
    );
    expect(migrationSql).toContain(
      'jsonb_build_object(p_evidence_key, p_evidence)'
    );
    expect(migrationSql).toContain(
      "existing->>'payment_transaction_id' = elem->>'payment_transaction_id'"
    );
  });
});
