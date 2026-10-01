import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../supabase/migrations/20260928177000_requeue_pending_legs_covered_only_by_unlinked_refunds.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('unlinked-refund pending-leg correction migration', () => {
  it('requeues completed refund side effects with link-uncovered pending legs', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'UPDATE public.order_cancellation_side_effects'
    );
    // Affected rows flip back to failed with a fresh attempt budget so
    // the drain resumes them; completed rows are never reselected.
    expect(migrationSql).toContain("SET status = 'failed'");
    expect(migrationSql).toContain('attempts = 0');
    expect(migrationSql).toContain('completed_at = NULL');
    expect(migrationSql).toContain("side_effect.step = 'refund'");
  });

  it('restricts pending-leg coverage to linked refunds like the claim predicate', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Only refund_pending legs are revisited: completed legs keep the
    // repair's verdict, where unlinked attribution to the sole
    // completed leg matches the claim rule.
    expect(migrationSql).toContain("payment.status = 'refund_pending'");
    expect(migrationSql).not.toContain("IN ('completed', 'refund_pending')");
    // A pending leg can never inherit the order's sole-completed-leg
    // refund, so coverage requires the explicit payment link and the
    // unlinked fallback must be absent.
    expect(migrationSql).toContain(
      "refund.metadata->>'payment_transaction_id' = payment.id::text"
    );
    expect(migrationSql).not.toContain(
      "refund.metadata->>'payment_transaction_id' IS NULL"
    );
  });

  it('keeps the verified-refund predicates and stays idempotent', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain('refund.gateway = payment.gateway');
    expect(migrationSql).toContain("refund.status = 'completed'");
    expect(migrationSql).toContain(
      'upper(refund.currency) = upper(payment.currency)'
    );
    expect(migrationSql).toContain(
      "refund.metadata->>'provider_refund_status' = 'processed'"
    );
    expect(migrationSql).toContain(
      'HAVING coalesce(sum(refund.amount), 0) >= payment.amount'
    );
    // Idempotent: a re-run matches nothing because requeued rows are
    // failed and covered rows stay completed.
    expect(migrationSql).toContain("side_effect.status = 'completed'");
  });
});
