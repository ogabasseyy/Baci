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

  it('requires provider verification on counted Paystack refunds', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "OR r.metadata->>'provider_refund_status' = 'processed'"
    );
  });

  it('waits for refund-state payment legs before completing the order', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "AND p.transaction_type = 'payment' AND p.status IN ('completed', 'refund_pending')"
    );
  });

  it('keeps completed rows completed on nonterminal provider verdicts', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "WHEN v_refund.status = 'completed' THEN 'completed'"
    );
  });

  it('reverses the order paystack settlements with the refund transition', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "AND settlement.source_id = v_order.id AND settlement.status IN ('pending', 'processing', 'settled')"
    );
    expect(migrationSql).not.toContain("settlement.gateway = 'paystack'");
    expect(migrationSql).toContain(
      "v_settlement.gateway || ' cancellation refund settlement reversal'"
    );
    expect(migrationSql).toContain(
      "v_settlement.merchant_id, 'debit', v_settlement.net_amount"
    );
    expect(migrationSql).toContain(
      "v_settlement.metadata ->> 'redvault_direct_split', 'false' ) = 'true'"
    );
    expect(migrationSql).toContain('IF NOT v_direct_split THEN');
  });

  it('keeps orphan provider evidence open until a local refund row matches it', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "review.metadata->>'audit_record_failed' IS DISTINCT FROM 'true'"
    );
    expect(migrationSql).toContain(
      "r.gateway_reference = review.metadata->>'provider_refund_id'"
    );
    expect(migrationSql).toContain(
      "r.gateway_reference = split_part(e.key, ':', 2)"
    );
  });
});
