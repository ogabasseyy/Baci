import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903080000_repair_pickup_receiver_projection.sql'
  ),
  'utf8'
);

describe('repair pickup receiver projection migration', () => {
  it('projects only published pickup destinations through SECURITY DEFINER', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.get_repair_pickup_receiver'
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('COALESCE(merchant.is_published, false)');
    expect(migration).toContain('pickup_enabled');
  });

  it('initially grants the projection to storefront quote roles', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_repair_pickup_receiver(uuid) FROM PUBLIC'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_repair_pickup_receiver(uuid)'
    );
    expect(migration).toContain('TO anon, authenticated, service_role');
  });
});
