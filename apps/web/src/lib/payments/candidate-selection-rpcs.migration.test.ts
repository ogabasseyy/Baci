import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184200_candidate_selection_rpcs.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('candidate selection RPC migration', () => {
  it.each([
    'select_abandoned_paystack_attempt_candidates_v1',
    'select_pending_paystack_cancellation_refund_candidates_v1',
    'select_completed_paystack_cancellation_refund_candidates_v1',
  ])('defines %s with a normalized gateway predicate', (fn) => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  });

  it('matches every branch on the normalized gateway', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'"
    );
    expect(migrationSql).not.toContain("t.gateway = 'paystack'");
    expect(migrationSql).not.toContain("gateway = 'paystack'");
  });

  it('keeps the pending cancellation scoping and the finalized-first order', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Only cancellation refunds: unrelated pending refunds would fail
    // verification with an order mismatch and get held out of their
    // own recovery path.
    expect(migrationSql).toContain(
      "AND t.description LIKE 'Refund for cancelled order #%'"
    );
    // The finalized contradiction recheck leads the completed batch
    // so a sustained backlog cannot starve it.
    expect(migrationSql).toContain('ORDER BY s.branch ASC, s.updated_at ASC');
  });
});
