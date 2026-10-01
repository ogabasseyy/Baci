import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('claim repair pickup booking terminal guard migration', () => {
  it('refuses terminal repairs and returns terminal=true from the claim RPC', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260904180000_claim_repair_pickup_booking_terminal_guard.sql'
      ),
      'utf8'
    );

    expect(migration).toContain(
      "AND r.status NOT IN ('completed', 'cancelled', 'rejected')"
    );
    expect(migration).toContain(
      "(r.status IN ('completed', 'cancelled', 'rejected')) AS terminal"
    );
    expect(migration).toContain('terminal boolean');
  });
});
