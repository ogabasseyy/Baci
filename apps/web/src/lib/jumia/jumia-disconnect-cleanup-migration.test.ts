import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd().endsWith(path.join('apps', 'web'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();
const migrationPath = path.join(
  repositoryRoot,
  'supabase/migrations/20260831150000_serialize_jumia_disconnect_cleanup.sql'
);

describe('Jumia disconnect cleanup migration', () => {
  it('serializes shared authorization cleanup after the shop lock', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain(
      "p_merchant_id::text || ':authorization:' || v_authorization_id::text"
    );
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain(
      'AND integration.jumia_authorization_id = v_authorization_id'
    );
  });
});
