import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928150000_requeue_falsely_completed_cancellation_refunds.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('requeue falsely completed cancellation refunds migration', () => {
  it('normalizes gateways exactly like the aggregate coverage gate', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Exact equality would miss refunds for a legacy leg the claim
    // gate finalized, leaving falsely completed rows unrequeued.
    expect(migrationSql).toContain(
      "AND NULLIF( upper( regexp_replace( COALESCE(refund.gateway, ''), '^\\s+|\\s+$', '', 'g' ) ), '' ) = NULLIF( upper( regexp_replace( COALESCE(payment.gateway, ''), '^\\s+|\\s+$', '', 'g' ) ), '' )"
    );
    expect(migrationSql).toContain(
      "NULLIF( upper( regexp_replace( COALESCE(refund.gateway, ''), '^\\s+|\\s+$', '', 'g' ) ), '' ) <> 'PAYSTACK'"
    );
  });
});
