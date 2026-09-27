import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825000900_persist_existing_jumia_authorization_rotation.sql'
  ),
  'utf8'
);

describe('existing Jumia authorization rotation migration', () => {
  it('updates one matching active self-authorization grant before returning existing shops', () => {
    expect(migration).toContain("connection_method = 'self_authorization'");
    expect(migration).toContain(
      'jumia_auth.client_key_hash = p_client_key_hash'
    );
    expect(migration).toContain('v_matching_count = cardinality(p_shop_ids)');
    expect(migration).toContain('v_authorization_count = 1');
    expect(migration).toContain(
      'credential_ciphertext = p_credential_ciphertext'
    );
    expect(migration).toContain(
      'rotation_version = jumia_auth.rotation_version + 1'
    );
    expect(migration).toMatch(
      /RETURN QUERY[\s\S]*false[\s\S]*ORDER BY selected\.position/
    );
    expect(migration).toContain("connection_method = 'oauth'");
    expect(migration).toContain('NULL::uuid');
  });
});
