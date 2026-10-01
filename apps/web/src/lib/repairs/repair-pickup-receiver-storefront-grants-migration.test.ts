import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903101000_repair_pickup_receiver_storefront_grants.sql'
  ),
  'utf8'
);

describe('repair pickup receiver storefront grants migration', () => {
  it('restores storefront EXECUTE without expanding beyond quote roles', () => {
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_repair_pickup_receiver(uuid)'
    );
    expect(migration).toContain('TO anon, authenticated, service_role');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_repair_pickup_receiver(uuid)'
    );
  });
});
