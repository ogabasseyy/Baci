import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904153400_order_gigl_internal_credit_retained_amount_projection.sql'
);

describe('order gigl internal credit retained amount projection migration', () => {
  it('exposes ledger retention only through a scoped SECURITY DEFINER projection', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_order_gigl_internal_credit_retained_amount\(/i
    );
    expect(sql).toContain('customer_wallet_transactions');
    expect(sql).toContain('customer_savings_redemptions');
    expect(sql).toContain("source_type = 'order_redemption'");
    expect(sql).toContain("metadata->>'reversed_at' IS NULL");
    expect(sql).toContain("ARRAY['wallet', 'savings', 'store_credit']");
    expect(sql).toMatch(/merchant\.user_id = \(SELECT auth\.uid\(\)\)/i);
    expect(sql).toMatch(/orders', 'fulfill'/i);
    expect(sql).toMatch(/orders', 'edit'/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_order_gigl_internal_credit_retained_amount\(uuid, uuid\)[\s\S]*FROM PUBLIC, anon;/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_order_gigl_internal_credit_retained_amount\(uuid, uuid\)[\s\S]*TO authenticated, service_role;/i
    );
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[^;]*anon/i);
  });

  it('bugfix: does not instruct authenticated clients to select customer ledgers directly', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).not.toMatch(
      /CREATE POLICY[\s\S]*customer_savings_redemptions[\s\S]*merchant/i
    );
  });
});
