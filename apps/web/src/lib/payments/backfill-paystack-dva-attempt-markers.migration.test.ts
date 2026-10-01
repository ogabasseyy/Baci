import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928120000_backfill_paystack_dva_attempt_markers.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('DVA attempt marker backfill migration', () => {
  it('stamps only attempts with DVA-session evidence', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The checkout session carries this attempt's reference AND a
    // virtual account number, which card sessions never set. An
    // order/time window alone would also stamp card attempts created
    // while the DVA account is live — and a transient provider 404
    // would then retire them instead of holding for re-verification.
    expect(migrationSql).toContain('FROM public.checkout_sessions s');
    expect(migrationSql).toContain('s.payment_reference = t.gateway_reference');
    expect(migrationSql).toContain('s.virtual_account_number IS NOT NULL');
    expect(migrationSql).not.toContain('order_payment_accounts');
    expect(migrationSql).not.toContain('expires_at');
    // Idempotent and marker-preserving: re-runs match nothing and
    // rows already carrying a payment type are untouched.
    expect(migrationSql).toContain(
      "coalesce(t.metadata->>'paystack_payment_type', '') = ''"
    );
  });
});
