import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183100_complete_order_gateway_payment_claim_completed_replays.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('complete-order-gateway-payment completed-replay claims migration', () => {
  it('replaces the wrapper in place without changing its signature', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.complete_order_gateway_payment('
    );
    expect(migrationSql).not.toContain('DROP FUNCTION');
    expect(migrationSql).toContain(
      'p_expected_outstanding_minor bigint DEFAULT NULL'
    );
  });

  it('claims watches on completed replays, not only fresh flips', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Both completion paths still claim exactly once each.
    const claims = migrationSql.split(
      'claim_paystack_refund_recovery_watches_v1('
    );
    expect(claims.length - 1).toBe(2);
    // The charge webhook flips the row to completed before invoking
    // this RPC, so a completed status may still be the first
    // completion racing an opener's empty scan: the delegated path
    // gates on a clean outcome only, never on pending status or the
    // already-completed flag. Replays find no open watches and no-op.
    expect(migrationSql).toContain(
      "IF v_completion ->> 'error_code' IS NULL THEN"
    );
    expect(migrationSql).not.toContain(
      "(v_completion ->> 'already_completed') IS DISTINCT FROM 'true'"
    );
    // The cancelled branch flips inline, then claims outside the
    // pending-only block so pre-flipped rows claim too.
    expect(migrationSql).toContain(
      'claim regardless. PERFORM public.claim_paystack_refund_recovery_watches_v1('
    );
  });

  it('stays within the 300-line file limit', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const lines = readFileSync(migrationPath, 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(300);
  });
});
