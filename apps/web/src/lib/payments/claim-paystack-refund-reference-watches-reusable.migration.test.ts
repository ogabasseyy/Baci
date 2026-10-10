import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183200_claim_paystack_refund_reference_watches_reusable.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('reusable reference watches migration', () => {
  it('keeps claimed reference watches visible to later completions', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_paystack_refund_recovery_watches_v1('
    );
    // A second legacy/corrupt payment completing under the same
    // reference must still file: the cursor covers already-claimed
    // reference rows (ID-keyed watches stay consume-once).
    expect(migrationSql).toContain(
      "AND ( status = 'open' OR (status = 'claimed' AND provider_refund_id IS NULL) )"
    );
    // Only the open->claimed flip consumes the sweep handoff and
    // counts: revisits file again and stay claimed.
    expect(migrationSql).toContain("IF v_watch.status = 'open' THEN");
    const claimed = migrationSql.split('v_claimed := v_claimed + 1;');
    expect(claimed.length - 1).toBe(2);
  });

  it('re-opens an already-claimed reference row when its filing fails', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Filing failures must never fail the completion, but leaving
    // the row claimed would strand the evidence only this
    // completion observed — so it re-opens for the sweep unless a
    // sibling open row already holds the handoff.
    expect(migrationSql).toContain(
      "AND v_watch.status = 'claimed' AND NOT EXISTS ( SELECT 1 FROM public.paystack_refund_recovery_watch"
    );
    expect(migrationSql).toContain(
      "SET status = 'open', updated_at = now() WHERE id = v_watch.id AND status = 'claimed'"
    );
  });
});
