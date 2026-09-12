import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904120000_record_repair_pickup_payment_mismatch.sql'
);

describe('record_repair_pickup_payment_mismatch migration', () => {
  it('creates a service-role mismatch ledger RPC with review updates', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.record_repair_pickup_payment_mismatch'
    );
    expect(sql).toContain("auth.role() <> 'service_role'");
    expect(sql).toContain("'claim_mismatch', true");
    expect(sql).toContain("pickup_payment_status = 'review'");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.record_repair_pickup_payment_mismatch'
    );
    expect(sql).toContain('TO service_role');
  });
});
