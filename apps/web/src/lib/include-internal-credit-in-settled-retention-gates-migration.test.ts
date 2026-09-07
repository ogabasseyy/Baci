import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260905112000_include_internal_credit_in_settled_retention_gates.sql'
  ),
  'utf8'
);

describe('include internal credit in settled retention gates migration', () => {
  it('combines settlements with capped internal-credit retention', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.order_settled_gigl_retained_amount('
    );
    expect(sql).toContain('customer_wallet_transactions');
    expect(sql).toContain('customer_savings_redemptions');
    expect(sql).toContain("ARRAY['wallet', 'savings', 'store_credit']");
    expect(sql).toContain("IS NOT DISTINCT FROM 'customer_checkout'");
    expect(sql).toContain('LEAST(');
  });
});
