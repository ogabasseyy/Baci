import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901193000_add_merchant_wallet_funding.sql'
  ),
  'utf8'
);
const hardeningSql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901203000_harden_shipping_charge_completion.sql'
  ),
  'utf8'
);
describe('merchant wallet funding migration contract', () => {
  it('defines protected request and account tables', () => {
    expect(sql).toMatch(/merchant_wallet_funding_account_requests/);
    expect(sql).toMatch(/merchant_wallet_payment_accounts/);
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.merchant_wallet_payment_accounts/
    );
    expect(sql).toMatch(/status.*active.*pending.*disabled/s);
  });
  it('derives owner-scoped RLS policies and grants', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/auth\.uid\(\).*merchant_id/s);
    expect(sql).toMatch(/CREATE POLICY merchant_wallet_account_owner/);
    expect(sql).toMatch(/REVOKE .*INSERT.*UPDATE.*DELETE/s);
    expect(sql).toMatch(
      /GRANT SELECT ON TABLE public\.merchant_wallet_payment_accounts TO authenticated/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.merchant_wallet_payment_accounts FROM anon, authenticated/
    );
    expect(sql).not.toMatch(
      /GRANT (?:INSERT|UPDATE|DELETE|ALL).*merchant_wallet_payment_accounts.*TO authenticated/i
    );
    expect(sql).toMatch(
      /CREATE POLICY merchant_wallet_account_owner ON public\.merchant_wallet_payment_accounts FOR SELECT USING \(EXISTS/
    );
  });
  it('locks request and account rows for verified transitions', () => {
    expect(sql).toMatch(
      /merchant_wallet_funding_account_requests[\s\S]*FOR UPDATE/
    );
    expect(sql).toMatch(/merchant_wallet_payment_accounts[\s\S]*FOR UPDATE/);
    expect(sql).toMatch(/reference.*unique|UNIQUE.*paystack/s);
  });
  it('preserves principal semantics in wallet transaction linkage', () => {
    expect(sql).toMatch(/wallet_transactions/);
    expect(sql).toMatch(/source_type.*merchant_wallet_topup/s);
    expect(sql).toMatch(/available_balance.*\+/s);
    expect(sql).toMatch(/total_earned/s);
  });
  it('enforces NGN and account status checks', () => {
    expect(sql).toMatch(/currency.*NGN/s);
    expect(sql).toMatch(/status.*active.*pending.*disabled/s);
    expect(sql).toMatch(/account_number/);
  });
  it('defines service-only assignment and idempotent credit RPCs', () => {
    expect(sql).toMatch(/persist_merchant_wallet_payment_account/);
    expect(sql).toMatch(/credit_merchant_wallet_funding/);
    expect(sql).toMatch(/merchant_wallet_topup/);
    expect(sql).toMatch(/p_reference/);
    expect(sql).toMatch(
      /total_earned = public\.merchant_wallets\.total_earned/s
    );
    expect(sql).toMatch(/auth\.role\(\).*service_role/s);
    expect(sql).toMatch(/SELECT id INTO STRICT v_account_id[\s\S]*FOR UPDATE/);
    expect(sql).toMatch(/merchant_wallet_account_mismatch/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.credit_merchant_wallet_funding/
    );
  });

  it('revokes and grants the fail RPC using its declared two-argument signature', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fail_merchant_wallet_funding_request\(p_request_id uuid,p_merchant_id uuid\)/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fail_merchant_wallet_funding_request\(uuid,uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fail_merchant_wallet_funding_request\(uuid,uuid\) TO authenticated/
    );
    expect(sql).not.toMatch(
      /REVOKE ALL ON FUNCTION public\.fail_merchant_wallet_funding_request\(uuid\)/
    );
  });

  it('allows authenticated request inserts only for pending owner rows', () => {
    expect(hardeningSql).toContain(
      'DROP POLICY IF EXISTS merchant_wallet_request_owner_insert'
    );
    expect(hardeningSql).toContain(
      "FOR INSERT TO authenticated\n  WITH CHECK (\n    status = 'pending'"
    );
    expect(hardeningSql).toContain(
      'm.id = merchant_wallet_funding_account_requests.merchant_id'
    );
    expect(hardeningSql).toContain('m.user_id = auth.uid()');
  });

  it('revokes request updates/deletes and grants only select/insert', () => {
    expect(hardeningSql).toContain(
      'REVOKE ALL ON TABLE public.merchant_wallet_funding_account_requests FROM PUBLIC, anon, authenticated;'
    );
    expect(hardeningSql).toContain(
      'GRANT SELECT, INSERT ON TABLE public.merchant_wallet_funding_account_requests TO authenticated;'
    );
    expect(hardeningSql).not.toMatch(
      /GRANT\s+(?:UPDATE|DELETE|ALL).*merchant_wallet_funding_account_requests.*authenticated/is
    );
  });
});
