import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903095000_repair_pickup_receiver_server_only.sql'
  ),
  'utf8'
);

describe('repair pickup receiver server-only migration', () => {
  it('requires a contact phone before projecting a destination', () => {
    expect(migration).toContain("repair_settings ->> 'contact_phone'");
    expect(migration).toContain(
      "NULLIF(btrim(settings.repair_settings ->> 'contact_phone'), '')"
    );
  });

  it('grants the projection to service_role only', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_repair_pickup_receiver(uuid)'
    );
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_repair_pickup_receiver(uuid)'
    );
    expect(migration).toContain('TO service_role');
  });
});
