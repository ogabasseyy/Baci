import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904130000_awaiting_repair_pickup_payment.sql'
);

describe('awaiting_repair_pickup_payment migration', () => {
  it('allows awaiting_payment and gates the mark RPC on receiver claims', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("'awaiting_payment'");
    expect(sql).toContain('repairs_pickup_payment_status_check');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.mark_repair_pickup_awaiting_payment'
    );
    expect(sql).toContain("auth.jwt() ->> 'repair_pickup_receiver_context'");
    expect(sql).toContain(
      "auth.jwt() ->> 'repair_pickup_receiver_merchant_id'"
    );
    expect(sql).toContain("pickup_payment_status = 'awaiting_payment'");
    expect(sql).toContain('TO repair_pickup_receiver');
  });
});
