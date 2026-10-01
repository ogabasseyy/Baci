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
    expect(migrationSql).not.toContain("t.status = 'completed'");
    expect(migrationSql).toContain("'refund', 'failed'");
  });
});
