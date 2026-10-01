import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('claim repair pickup booking manual_fulfilled guard migration', () => {
  it('refuses manual_fulfilled repairs and returns terminal=true from the claim RPC', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260904190700_claim_repair_pickup_booking_manual_fulfilled_guard.sql'
      ),
      'utf8'
    );

    expect(migration).toContain(
      "AND r.pickup_payment_status IS DISTINCT FROM 'manual_fulfilled'"
    );
    expect(migration).toContain(
      "OR r.pickup_payment_status = 'manual_fulfilled'"
    );
    expect(migration).toContain('terminal boolean');
  });
});
