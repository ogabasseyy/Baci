import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182000_paystack_refund_recovery_watch.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('refund-recovery watch migration', () => {
  it('creates one open watch per refund with a sweep index', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE TABLE IF NOT EXISTS public.paystack_refund_recovery_watch'
    );
    // A redelivered opener must refresh the existing watch, not stack
    // a second open row the claim would file twice.
    expect(migrationSql).toContain('paystack_refund_recovery_watch_open_idx');
    expect(migrationSql).toContain("WHERE status = 'open'");
    expect(migrationSql).toContain('paystack_refund_recovery_watch_sweep_idx');
  });

  it('opens the watch and re-scans atomically under the reference lock', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.open_paystack_refund_recovery_watch_v1('
    );
    // The completion path claims under this same key: whichever side
    // commits first wins, and the other side observes it.
    expect(migrationSql).toContain("'baci_paystack_refund_watch:'");
    // The confirming scan mirrors fetchCompletedPaymentsByReference —
    // same filter, same stable id order.
    expect(migrationSql).toContain("t.gateway = 'paystack'");
    expect(migrationSql).toContain("t.transaction_type = 'payment'");
    expect(migrationSql).toContain("t.status = 'completed'");
    expect(migrationSql).toContain('jsonb_agg(row ORDER BY');
  });

  it('resolves open and claimed watches without touching retired rows', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.resolve_paystack_refund_recovery_watch_v1('
    );
    expect(migrationSql).toContain("status IN ('open', 'claimed')");
  });
});
