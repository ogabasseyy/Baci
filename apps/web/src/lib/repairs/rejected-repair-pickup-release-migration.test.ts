import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901220400_atomic_rejected_repair_pickup_release.sql'
  ),
  'utf8'
);

describe('rejected repair pickup release migration', () => {
  it('locks the claimed repair and releases the shipment and lock atomically', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.release_rejected_repair_pickup_reservation'
    );
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain('DELETE FROM public.shipments AS shipment');
    expect(migration).toContain('repair.shipment_id IS NULL');
    expect(migration).toContain(
      "RAISE EXCEPTION 'rejected_repair_pickup_lock_not_cleared'"
    );
  });

  it('limits execution to authorized repair editors and service role', () => {
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("'repairs',");
    expect(migration).toContain("'edit'");
    expect(migration).toContain('TO authenticated, service_role;');
    expect(migration).toContain(
      'FROM PUBLIC, anon, authenticated, service_role;'
    );
  });
});
