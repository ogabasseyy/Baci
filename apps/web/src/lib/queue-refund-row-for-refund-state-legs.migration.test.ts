import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../supabase/migrations/20260928176000_queue_refund_row_for_refund_state_legs.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('refund-state side-effect row migration', () => {
  it('queues the refund row for the claim gate funded statuses', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.cancel_order_as_merchant('
    );
    // The claim gate admits completed, refund_pending, and self-terminal
    // refunded legs: queueing only completed legs would let a
    // refund-state-only cancellation succeed without the row the claim
    // needs, stranding settlement reversal and notifications.
    expect(migrationSql).toContain(
      "t.status IN ('completed', 'refund_pending', 'refunded')"
    );
    // The backfill below legitimately reuses the old predicate to
    // exclude completed-leg orders; only the function body must not.
    const functionSql = migrationSql.split(
      '-- Backfill the refund step for orders already cancelled'
    )[0];
    expect(functionSql).not.toContain("t.status = 'completed'");
    expect(migrationSql).toContain("'refund', 'failed'");
  });

  it('backfills missing refund steps for already-cancelled refund-state orders', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The replacement function only covers future cancellations: without
    // a backfill, existing refund-state-only cancellations still have no
    // row for the drain to resume.
    expect(migrationSql).toContain(
      'INSERT INTO public.order_cancellation_side_effects'
    );
    expect(migrationSql).toContain(
      "t.status IN ('refund_pending', 'refunded')"
    );
    // Completed-leg orders got rows under the old function: only orders
    // with no completed external leg qualify, and rows in any status
    // are never resurrected.
    expect(migrationSql).toContain(
      'AND NOT EXISTS ( SELECT 1 FROM public.transactions t'
    );
    expect(migrationSql).toContain(
      'AND NOT EXISTS ( SELECT 1 FROM public.order_cancellation_side_effects s'
    );
    expect(migrationSql).toContain('ON CONFLICT (order_id, step) DO NOTHING');
  });
});
