import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd().endsWith(path.join('apps', 'web'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();
const migration = readFileSync(
  path.join(
    repositoryRoot,
    'supabase/migrations/20260825001000_purge_displaced_jumia_authorizations.sql'
  ),
  'utf8'
);

describe('displaced Jumia authorization purge migration', () => {
  it('purges a replaced grant only after its final integration reference moves', () => {
    expect(migration).toContain(
      'OLD.jumia_authorization_id IS DISTINCT FROM NEW.jumia_authorization_id'
    );
    expect(migration).toContain(
      'WHERE integration.jumia_authorization_id = OLD.jumia_authorization_id'
    );
    expect(migration).toContain(
      'AFTER UPDATE OF jumia_authorization_id ON public.marketplace_integrations'
    );
    expect(migration).toContain("SET credential_ciphertext = repeat('0', 32)");
  });

  it('does not expose the trigger function as an RPC', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated;');
  });
});
