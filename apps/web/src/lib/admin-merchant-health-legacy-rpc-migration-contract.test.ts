import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151660_retire_legacy_admin_merchant_health_rpc.sql'
);

describe('legacy admin merchant-health RPC retirement migration', () => {
  it('retires direct execution of the unbounded legacy reader', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_admin_merchant_health()'
    );
    expect(migration).toContain(
      'FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(migration).toContain('get_admin_merchant_health_v2');
    expect(migration).not.toContain('GRANT EXECUTE ON FUNCTION');
  });
});
