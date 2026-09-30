import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928140000_aggregate_claim_refund_coverage.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('aggregate claim refund coverage migration', () => {
  it('restricts the unlinked fallback to the completed leg', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Mirrors the completion gate: a refund_pending leg is mid-flight
    // with its own outstanding refund, so the same verified refund
    // must not satisfy it through the unlinked fallback.
    expect(migrationSql).toContain(
      "refund.metadata->>'payment_transaction_id' IS NULL -- As in the completion gate: the unlinked refund -- attributes to the sole completed leg only, never to a -- refund_pending leg whose own provider refund is still -- outstanding. AND payment.status = 'completed' AND 1 = ("
    );
  });
});
