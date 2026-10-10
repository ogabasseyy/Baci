import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../supabase/migrations/20260928180000_merge_leg_evidence_provider_refund_status.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('leg-evidence provider-verdict migration', () => {
  it('replaces the merge function with the optional verdict parameter', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The trailing parameter cannot be added with OR REPLACE: without
    // the DROP the old body would survive as an overload and every
    // existing call would keep merging verdict-less entries.
    expect(migrationSql).toContain(
      'DROP FUNCTION IF EXISTS public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid, uuid, uuid, text, jsonb, jsonb, boolean);'
    );
    expect(migrationSql).toContain(
      'p_provider_refund_status text DEFAULT NULL'
    );
  });

  it('stores the verdict with the marker and leg id the reader keys on', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The audit-blocking reader keys failed-only exclusion on marked
    // entries carrying the leg id and provider verdict; it reads
    // entry values, never the leg key.
    expect(migrationSql).toContain("'audit_record_failed', true");
    expect(migrationSql).toContain(
      "'payment_transaction_id', p_payment_transaction_id::text"
    );
    expect(migrationSql).toContain(
      "'provider_refund_status', p_provider_refund_status"
    );
  });

  it('preserves the service-role-only grant on the new signature', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid,uuid,uuid,text,jsonb,jsonb,boolean,text)'
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid,uuid,uuid,text,jsonb,jsonb,boolean,text) TO service_role;'
    );
  });
});
