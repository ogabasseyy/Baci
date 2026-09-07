import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904082500_restore_wallet_shipping_charge_staff_authorization.sql'
  ),
  'utf8'
);

describe('restore wallet shipping charge staff authorization migration', () => {
  it('restores fulfill/edit staff checks on reserve without owner-only auth', () => {
    const reserveSql = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge'
      )
    );
    expect(reserveSql).toContain("'orders', 'fulfill'");
    expect(reserveSql).toContain("'orders', 'edit'");
    expect(reserveSql).toContain('check_staff_permission');
    expect(reserveSql).not.toContain('merchant.user_id = (SELECT auth.uid())');
  });

  it('keeps the stale provider_submitting reconciliation gate from 220600', () => {
    expect(sql).toContain("v_existing.status = 'provider_submitting'");
    expect(sql).toContain("failure_code = 'STALE_PROVIDER_SUBMISSION'");
    expect(sql).toContain("interval '15 minutes'");
  });
});
