import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsRoot = path.resolve(
  import.meta.dirname,
  '../../../../../supabase/migrations'
);

const migration = readFileSync(
  path.join(
    migrationsRoot,
    '20260925120000_raise_jumia_credential_ciphertext_limit.sql'
  ),
  'utf8'
);

describe('Jumia credential ciphertext limit migration', () => {
  it('raises both table checks to 32k', () => {
    expect(migration).toMatch(
      /ADD CONSTRAINT jumia_self_authorization_discoveries_credential_ciphertext_check[\s\S]*?BETWEEN 32 AND 32768/i
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT jumia_authorizations_credential_ciphertext_check[\s\S]*?BETWEEN 32 AND 32768/i
    );
  });

  it('raises every RPC ciphertext guard to match the tables', () => {
    const guards = migration.match(
      /char_length\(p_credential_ciphertext\) NOT BETWEEN 32 AND 32768/g
    );
    // base persist, ordered persist, the rotate overload, and both
    // discovery handoff RPCs.
    expect(guards).toHaveLength(5);
    expect(migration).not.toMatch(
      /char_length\(p_credential_ciphertext\) NOT BETWEEN 32 AND 16384/
    );
  });

  it('recreates the discovery handoff RPCs with the raised limit', () => {
    for (const rpc of [
      'create_jumia_self_authorization_discovery',
      'update_claimed_jumia_self_authorization_discovery',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${rpc}[\\s\\S]*?BETWEEN 32 AND 32768`,
          'i'
        )
      );
    }
  });
});
