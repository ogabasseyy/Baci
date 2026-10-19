import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manualMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190300_manual_fulfilled_repair_pickup_payment_status.sql'
);
const historyMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190400_repair_pickup_pending_payment_references.sql'
);
const consumeMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190450_consume_repair_pickup_pending_payment_references.sql'
);

describe('manual_fulfilled repair pickup payment status migration', () => {
  it('allows manual_fulfilled distinct from payment-side review', () => {
    const sql = readFileSync(manualMigrationPath, 'utf8');
    expect(sql).toContain("'manual_fulfilled'");
    expect(sql).toContain('repairs_pickup_payment_status_check');
    expect(sql).toContain("'review'");
  });
});

describe('repair_pickup_pending_payment_references migration', () => {
  it('stores every pending RPU reference in a history table', () => {
    const sql = readFileSync(historyMigrationPath, 'utf8');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS public.repair_pickup_pending_payment_references'
    );
    expect(sql).toContain('UNIQUE (reference)');
    expect(sql).toContain('ON CONFLICT (reference) DO NOTHING');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.bind_repair_pickup_pending_payment_reference'
    );
  });

  it('consumes history rows on confirm and mismatch without wiping newer tips', () => {
    const sql = readFileSync(consumeMigrationPath, 'utf8');
    expect(sql).toContain('consumed_at = now()');
    expect(sql).toContain(
      'WHEN repair.pickup_payment_pending_reference = p_reference THEN NULL'
    );
    expect(sql).toContain("'manual_fulfilled'");
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.confirm_repair_pickup_payment'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.record_repair_pickup_payment_mismatch'
    );
  });
});

const preserveLateCaptureMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190500_preserve_manual_fulfilled_on_late_pickup_capture.sql'
);
const deferConsumeMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190600_defer_repair_pickup_pending_consume_until_fulfilled.sql'
);

describe('preserve manual_fulfilled on late pickup capture migration', () => {
  it('keeps manual_fulfilled and booked terminal while still ledging late capture', () => {
    const sql = readFileSync(preserveLateCaptureMigrationPath, 'utf8');
    expect(sql).toContain(
      "WHEN v_repair.pickup_payment_status IN ('manual_fulfilled', 'booked')"
    );
    expect(sql).toContain(
      'WHEN v_preserve_status IS NOT NULL THEN v_preserve_status'
    );
    expect(sql).toContain('preserved_pickup_payment_status');
    expect(sql).toContain('consumed_at = now()');
  });
});

describe('defer repair pickup pending consume until fulfilled migration', () => {
  it('keeps pending history after confirm until booked or manual_fulfilled', () => {
    const sql = readFileSync(deferConsumeMigrationPath, 'utf8');
    expect(sql).toContain(
      'private.consume_repair_pickup_pending_payment_references'
    );
    expect(sql).toContain('consume_repair_pickup_pending_on_fulfilled');
    expect(sql).toContain("'booked', 'manual_fulfilled'");
    expect(sql).toContain('IF v_preserve_status IS NOT NULL THEN');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.confirm_repair_pickup_payment'
    );
  });
});
