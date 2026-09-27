import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260927150500_complete_legacy_paystack_cancellation_refunds.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('verified paystack cancellation refund migration', () => {
  it('accepts unlinked legacy refunds through the sole-payment rule', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "IF NOT FOUND AND v_refund.metadata->>'payment_transaction_id' IS NULL THEN"
    );
    expect(migrationSql).toContain('IF v_external_payments = 1 THEN');
    expect(migrationSql).toContain('AND gateway = v_refund.gateway');
  });

  it('clears stale review holds whenever provider evidence is accepted', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "(coalesce(metadata, '{}'::jsonb) - 'refund_reconciliation_hold')"
    );
    expect(migrationSql).not.toContain(
      "THEN 'refund_reconciliation_hold' ELSE"
    );
  });

  it('counts unlinked legacy refunds toward order completion', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "r.metadata->>'payment_transaction_id' = p.id::text"
    );
    expect(migrationSql).toContain(
      "r.metadata->>'payment_transaction_id' IS NULL"
    );
  });

  it('requires matching currencies for every refunded payment leg', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain('AND upper(r.currency) = upper(p.currency)');
  });
});
