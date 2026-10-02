import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260927150000_paystack_cancellation_refund_completion.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('paystack cancellation refund notification claims', () => {
  it('dead-letters rows that exhausted their retries', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "WHERE status IN ('pending', 'failed') AND attempts >= 5"
    );
    expect(migrationSql).toContain(
      "'Notification retry limit exhausted; delivery outcome needs review'"
    );
  });
});
