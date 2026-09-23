import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903101500_secure_repair_pickup_receiver_capability.sql'
  ),
  'utf8'
);

describe('repair pickup receiver capability migration', () => {
  it('requires matching server context and merchant claims', () => {
    expect(migration).toContain(
      "auth.jwt() ->> 'repair_pickup_receiver_context'"
    );
    expect(migration).toContain(
      "auth.jwt() ->> 'repair_pickup_receiver_merchant_id'"
    );
    expect(migration).toContain('IS DISTINCT FROM p_merchant_id::text');
    expect(migration).toContain("THEN '{}'::jsonb");
  });

  it('leaves execute available only to the dedicated scoped role', () => {
    expect(migration).toContain('CREATE ROLE repair_pickup_receiver NOLOGIN');
    expect(migration).toContain(
      'GRANT repair_pickup_receiver TO authenticator'
    );
    expect(migration).toContain(
      'FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver'
    );
    expect(migration).toContain('TO repair_pickup_receiver');
  });
});
