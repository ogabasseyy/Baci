import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182200_complete_order_gateway_payment_claim_refund_watches.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('complete-order-gateway-payment watch-claim migration', () => {
  it('replaces the wrapper in place without changing its signature', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // No parameter changes, so OR REPLACE keeps every existing call
    // on the new body without the DROP an overload would need.
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.complete_order_gateway_payment('
    );
    expect(migrationSql).not.toContain('DROP FUNCTION');
    expect(migrationSql).toContain(
      'p_expected_outstanding_minor bigint DEFAULT NULL'
    );
  });

  it('claims watches after the flip on both completion paths', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Cancelled orders flip inline without delegating to _v1, so both
    // the inline flip and the delegated return claim.
    const claims = migrationSql.split(
      'claim_paystack_refund_recovery_watches_v1('
    );
    expect(claims.length - 1).toBe(2);
    // Replays and error outcomes never claim: only a fresh flip can
    // land after a recovery scan.
    expect(migrationSql).toContain("v_txn_status = 'pending'");
    expect(migrationSql).toContain(
      "(v_completion ->> 'already_completed') IS DISTINCT FROM 'true'"
    );
    expect(migrationSql).toContain("v_completion ->> 'error_code' IS NULL");
  });
});
