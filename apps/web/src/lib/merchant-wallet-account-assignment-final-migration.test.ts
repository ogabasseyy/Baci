import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903132000_finalize_merchant_wallet_account_assignment.sql`,
  'utf8'
);

describe('final merchant-wallet account assignment migration', () => {
  it('locks the exact request before accepting an assignment', () => {
    expect(sql).toContain(
      'WHERE id = p_request_id AND merchant_id = p_merchant_id\n  FOR UPDATE'
    );
    expect(sql).toContain(
      "IF v_request.status IS DISTINCT FROM 'pending' THEN"
    );
    expect(sql).toContain("RAISE EXCEPTION 'funding_request_not_pending'");
  });

  it('keeps only an exact fulfilled replay idempotent', () => {
    expect(sql).toContain("IF v_request.status = 'fulfilled' THEN");
    expect(sql).toContain(
      'v_row.account_name IS NOT DISTINCT FROM p_account_name'
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'conflicting_assignment_replay' USING ERRCODE = 'P0001'"
    );
  });

  it('guards the terminal transition against delayed assignment overwrite', () => {
    expect(sql).toContain(
      "AND status = 'pending';\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'funding_request_not_pending'"
    );
    expect(sql.indexOf("IF v_request.status = 'fulfilled' THEN")).toBeLessThan(
      sql.indexOf("IF v_request.status IS DISTINCT FROM 'pending' THEN")
    );
  });
});
