import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903122000_require_pending_wallet_account_assignment.sql`,
  'utf8'
);

describe('pending merchant-wallet assignment RPC', () => {
  it('rejects every non-pending request after the fulfilled replay case', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.persist_merchant_wallet_payment_account('
    );
    expect(sql).toContain("IF v_request.status = 'fulfilled' THEN");
    expect(sql).toContain(
      "IF v_request.status IS DISTINCT FROM 'pending' THEN"
    );
    expect(sql).toContain("RAISE EXCEPTION 'funding_request_not_pending'");
    expect(sql.indexOf("IF v_request.status = 'fulfilled' THEN")).toBeLessThan(
      sql.indexOf("IF v_request.status IS DISTINCT FROM 'pending' THEN")
    );
  });
});
