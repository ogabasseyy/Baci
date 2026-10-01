import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bindMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190000_bind_repair_pickup_pending_payment_reference.sql'
);
const clearMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190050_clear_repair_pickup_pending_payment_reference.sql'
);

describe('bind_repair_pickup_pending_payment_reference migration', () => {
  it('adds a pending reference column and capability-gated bind RPC', () => {
    const sql = readFileSync(bindMigrationPath, 'utf8');
    expect(sql).toContain('pickup_payment_pending_reference');
    expect(sql).toContain(
      'repairs_pickup_payment_pending_reference_unique_idx'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.bind_repair_pickup_pending_payment_reference'
    );
    expect(sql).toContain("auth.jwt() ->> 'repair_pickup_receiver_context'");
    expect(sql).toContain('TO repair_pickup_receiver');
    expect(sql).not.toContain('pickup_payment_reference = p_reference');
  });

  it('clears pending reference on confirm and mismatch ledger writes', () => {
    const sql = readFileSync(clearMigrationPath, 'utf8');
    expect(sql).toContain('pickup_payment_pending_reference = NULL');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.confirm_repair_pickup_payment'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.record_repair_pickup_payment_mismatch'
    );
  });
});
