import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182100_claim_paystack_refund_recovery_watches.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('claim refund-recovery watches migration', () => {
  it('claims under the opener reference lock for paystack completions only', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.claim_paystack_refund_recovery_watches_v1('
    );
    expect(migrationSql).toContain("'baci_paystack_refund_watch:'");
    // Watches are paystack-reference watches: a colliding reference
    // from another gateway must not claim them.
    expect(migrationSql).toContain("v_txn_gateway IS DISTINCT FROM 'paystack'");
    expect(migrationSql).toContain('FOR UPDATE');
  });

  it('routes cancelled orders to the recovery queue and active orders outside it', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Mirrors the recovery filers' cancellation gate: verified refunds
    // on active orders must not absorb a future genuine
    // cancellation's queue entry.
    expect(migrationSql).toContain('file_paystack_refund_recovery_review_v1(');
    expect(migrationSql).toContain("'provider_refund_outside_cancellation'");
    expect(migrationSql).toContain(
      'merge_provider_refund_outside_cancellation_evidence_v1('
    );
    // The audit-blocking reader keys failed-only exclusion on marked
    // entries carrying the leg id and provider verdict.
    expect(migrationSql).toContain("'provider_refund_status'");
    expect(migrationSql).toContain("'candidate_payment_transaction_ids'");
  });

  it('never fails the completion when a single watch cannot be filed', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Per-watch containment: the watch stays open for the sweep while
    // the payment completion commits.
    expect(migrationSql).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(migrationSql).toContain('RAISE WARNING');
    expect(migrationSql).toContain("SET status = 'claimed'");
  });
});
