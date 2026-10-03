import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928179000_record_verified_paystack_cancellation_refund.sql'
);

const finalizePath = resolve(
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
    expect(migrationSql).toContain(
      'AND public.normalized_gateway_name_v1(gateway) = public.normalized_gateway_name_v1(v_refund.gateway)'
    );
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

  it('restricts the unlinked fallback to the completed leg', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // A refund_pending leg is mid-flight with its own outstanding
    // refund: without the completed-leg condition the same verified
    // refund would satisfy both legs and retire the order early.
    expect(migrationSql).toContain(
      "r.metadata->>'payment_transaction_id' IS NULL -- The unlinked legacy refund attributes to the sole -- completed leg only: a refund_pending leg is mid-flight -- with its own outstanding refund, so the same completed -- refund must not also satisfy it (or one verified -- refund would retire two legs while the second provider -- refund is still pending). AND p.status = 'completed' AND 1 = ("
    );
  });

  it('requires matching currencies for every refunded payment leg', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'AND upper(btrim(r.currency)) = upper(btrim(p.currency))'
    );
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
    // Settlement reversal lives in the shared aggregate finalizer,
    // which stayed in the original migration when the provider-verdict
    // transition moved out.
    expect(existsSync(finalizePath)).toBe(true);
    if (!existsSync(finalizePath)) return;

    const migrationSql = normalizeSql(readFileSync(finalizePath, 'utf8'));

    expect(migrationSql).toContain(
      "AND settlement.source_id = p_order_id AND settlement.status IN ('pending', 'processing', 'settled')"
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

  it('requeues the failure alert when a newer failure lands on a settled row', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'ON CONFLICT (order_id, event_type) DO UPDATE SET'
    );
    expect(migrationSql).toContain("status = 'pending', attempts = 0");
    expect(migrationSql).toContain(
      "paystack_cancellation_refund_notifications.status IN ('sent', 'failed', 'delivery_uncertain')"
    );
  });

  it('keeps each state machine in its own sub-300-line migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(finalizePath)).toBe(true);
    if (!existsSync(migrationPath) || !existsSync(finalizePath)) return;

    for (const path of [migrationPath, finalizePath]) {
      const lines = readFileSync(path, 'utf8').split('\n').length;
      expect(lines).toBeLessThanOrEqual(300);
    }
    // The split moved only the location: the transition still
    // delegates covered orders to the shared finalizer, which still
    // owns the settlement reversal.
    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));
    const finalizeSql = normalizeSql(readFileSync(finalizePath, 'utf8'));
    expect(migrationSql).toContain(
      'PERFORM public.finalize_refunded_cancellation_order_v1('
    );
    expect(finalizeSql).not.toContain(
      'FUNCTION public.record_verified_paystack_cancellation_refund_v1('
    );
  });

  it('alerts only on failure transitions, not repeat polling verdicts', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "v_refund.metadata->>'provider_refund_status' = v_status"
    );
    // Repeat verdicts still rotate updated_at so reviewed nonterminal
    // rows cannot pin the workers' oldest-25 batch.
    expect(migrationSql).toContain(
      'UPDATE public.transactions SET updated_at = now() WHERE id = v_refund.id'
    );
  });

  it('normalizes gateways exactly like the aggregate coverage gate', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The unlinked legacy path and the completion scan must agree
    // with the claim gate on a legacy `Paystack` leg and its
    // `paystack` refund.
    expect(migrationSql).toContain(
      'AND public.normalized_gateway_name_v1(gateway) = public.normalized_gateway_name_v1(v_refund.gateway)'
    );
    // The external-leg count normalizes too: a raw gateway against an
    // uppercase internal list would count wallet legs as external and
    // misfire the sole-payment rule.
    expect(migrationSql).toContain(
      "AND COALESCE(public.normalized_gateway_name_v1(gateway), '') NOT IN ("
    );
    expect(migrationSql).not.toContain("coalesce(gateway, '') NOT IN");
    expect(migrationSql).toContain(
      'AND public.normalized_gateway_name_v1(r.gateway) = public.normalized_gateway_name_v1(p.gateway)'
    );
    expect(migrationSql).toContain(
      "public.normalized_gateway_name_v1(r.gateway) <> 'PAYSTACK'"
    );
  });
});
