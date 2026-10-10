import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182600_file_paystack_refund_reference_watch_claim.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('reference-watch claim filing migration', () => {
  it('routes cancelled orders to the recovery queue with reference evidence', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.file_paystack_refund_reference_watch_claim_v1('
    );
    // Payload mirrors file-reference-only-paystack-refund-review:
    // reference-keyed so a later leg-keyed merge never overwrites it.
    expect(migrationSql).toContain('file_paystack_refund_recovery_review_v1(');
    expect(migrationSql).toContain("'reference:' || p_reference");
    expect(migrationSql).toContain("'reference_only_refund_event', true");
  });

  it('files active orders outside cancellation with verdict-suffixed keys', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain("'provider_refund_outside_cancellation'");
    // Mirrors the TS verdict suffix: without it a later genuine
    // refund would overwrite an earlier failed one under one key.
    expect(migrationSql).toContain("'payment:' || p_transaction_id::text");
    expect(migrationSql).toContain(
      'merge_provider_refund_outside_cancellation_evidence_v1('
    );
  });

  it('raises instead of claiming unfiled evidence', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The caller's per-watch handler catches the raise and leaves the
    // watch open for the sweep; claiming here would drop evidence.
    expect(migrationSql).toContain(
      "RAISE EXCEPTION 'reference watch recovery review filing failed'"
    );
    expect(migrationSql).toContain(
      "RAISE EXCEPTION 'reference watch outside-cancellation merge failed'"
    );
  });
});
