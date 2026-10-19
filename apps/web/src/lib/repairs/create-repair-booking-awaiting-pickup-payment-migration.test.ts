import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904150000_create_repair_booking_awaiting_pickup_payment.sql'
);

describe('create_repair_booking awaiting pickup payment migration', () => {
  it('inserts pickup rows with awaiting_payment atomically', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.create_repair_booking'
    );
    expect(sql).toContain('pickup_payment_status');
    expect(sql).toContain(
      "WHEN v_service_type = 'pickup' THEN 'awaiting_payment'"
    );
    expect(sql).toContain('ELSE NULL');
  });
});
