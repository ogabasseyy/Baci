import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928172000_flag_paystack_cancellation_over_refunds.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('flag paystack cancellation over refunds migration', () => {
  it('files an unresolved review when refunds exceed a payment leg', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.flag_paystack_cancellation_over_refunds_v1('
    );
    expect(migrationSql).toContain(
      'HAVING coalesce(sum(r.amount), 0) > p.amount'
    );
    expect(migrationSql).toContain(
      "'order_cancellation_over_refund_requires_review'"
    );
    // Concurrent finalizations must not duplicate the open review.
    expect(migrationSql).toContain('ON CONFLICT DO NOTHING');
  });

  it('normalizes gateways exactly like the aggregate coverage gate', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Exact equality would miss refunds for a legacy leg the claim
    // gate finalized, hiding excess provider debits — and an exact
    // Paystack gate would let a legacy `Paystack` row count without
    // provider verification.
    expect(migrationSql).toContain(
      'AND public.normalized_gateway_name_v1(r.gateway) = public.normalized_gateway_name_v1(p.gateway)'
    );
    expect(migrationSql).toContain(
      "public.normalized_gateway_name_v1(r.gateway) <> 'PAYSTACK'"
    );
  });

  it('merges later excess into the open review instead of discarding it', () => {
    const mergePath = resolve(
      __dirname,
      '../../../../../supabase/migrations/20260928184900_merge_over_refund_evidence_into_open_review.sql'
    );
    expect(existsSync(mergePath)).toBe(true);
    if (!existsSync(mergePath)) return;

    const mergeSql = normalizeSql(readFileSync(mergePath, 'utf8'));

    // Same signature: OR REPLACE keeps every existing call on the
    // new body.
    expect(mergeSql).toContain(
      'CREATE OR REPLACE FUNCTION public.flag_paystack_cancellation_over_refunds_v1('
    );
    // The open review absorbs the recomputed legs on conflict: a
    // later provider-verified refund must grow the review, never
    // vanish into DO NOTHING while ops resolves stale amounts.
    expect(mergeSql).toContain(
      'ON CONFLICT (issue_type, order_id) WHERE resolved_at IS NULL AND order_id IS NOT NULL DO UPDATE SET'
    );
    expect(mergeSql).toContain('merge_over_refund_review_legs_v1(');
    expect(mergeSql).not.toContain('ON CONFLICT DO NOTHING');
    // Keyed union: incoming legs win per payment leg, untouched
    // legs persist, order is deterministic.
    expect(mergeSql).toContain("elem->>'payment_transaction_id'");
    expect(mergeSql).toContain('priority DESC');
  });

  it('wires the over-refund flag into the shared finalizer', () => {
    const finalizePath = resolve(
      __dirname,
      '../../../../../supabase/migrations/20260927150500_complete_legacy_paystack_cancellation_refunds.sql'
    );
    expect(existsSync(finalizePath)).toBe(true);
    if (!existsSync(finalizePath)) return;

    const finalizeSql = normalizeSql(readFileSync(finalizePath, 'utf8'));

    expect(finalizeSql).toContain(
      'PERFORM public.flag_paystack_cancellation_over_refunds_v1(p_order_id, p_merchant_id)'
    );
  });
});
