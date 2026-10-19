import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../supabase/migrations/20260928178000_guard_partial_capture_balance_change.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('partial-capture balance-change guard migration', () => {
  it('adds the optional expected-outstanding parameter without an overload', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // CREATE OR REPLACE cannot add a parameter: without the DROP the
    // old 4-arg body would survive as an overload and every existing
    // 4-arg call would keep running unguarded.
    expect(migrationSql).toContain(
      'DROP FUNCTION IF EXISTS public.complete_order_gateway_payment( uuid, uuid, jsonb, text );'
    );
    expect(migrationSql).toContain(
      'p_expected_outstanding_minor bigint DEFAULT NULL'
    );
  });

  it('refuses to promote when the locked balance moved, before any write', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain("'error_code', 'BALANCE_CHANGED'");
    expect(migrationSql).toContain('p_expected_outstanding_minor IS NOT NULL');
    // Integer minor units on both sides: a tolerance would admit
    // genuine one-kobo overpayments past the gate.
    expect(migrationSql).toContain(
      'greatest( 0, round((v_order_total - v_order_amount_paid) * 100) )::bigint'
    );
    // The guard must precede every write: returning after the
    // transaction flip would strand a completed row on a
    // partially-paid order no sweep reselects.
    const guardAt = migrationSql.indexOf("'error_code', 'BALANCE_CHANGED'");
    const firstWriteAt = migrationSql.indexOf('UPDATE public.transactions');
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstWriteAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstWriteAt);
  });

  it('skips replays and orders that cannot promote', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Replays keep the legacy path: their money is already in.
    expect(migrationSql).toContain("v_txn_status = 'pending'");
    // Cancelled rows keep the cancelled outcome, paid rows keep the
    // already-paid outcome that files the duplicate review, refunded
    // rows keep the skip.
    expect(migrationSql).toContain(
      "lower(COALESCE(v_order_payment_status, '')) NOT IN ( 'canceled', 'cancelled', 'paid', 'refunded' )"
    );
  });

  it('preserves the service-role-only grant on the new signature', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // DROP discards grants: re-issue them for the 5-arg signature or
    // every completion call fails forbidden.
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.complete_order_gateway_payment( uuid, uuid, jsonb, text, bigint ) FROM PUBLIC, anon, authenticated;'
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.complete_order_gateway_payment( uuid, uuid, jsonb, text, bigint ) TO service_role;'
    );
  });
});
