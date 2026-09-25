import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260825001100_allow_active_jumia_view_credential_refresh.sql'
  ),
  'utf8'
);

describe('allow active Jumia view credential refresh migration', () => {
  it('permits integration viewers to refresh credentials', () => {
    expect(migration).toContain("'integrations',\n      'view'");
    expect(migration).not.toContain("'integrations',\n      'manage'");
  });

  it('requires an active self-authorization reference for both RPCs', () => {
    expect(
      migration.match(/integration\.connection_method = 'self_authorization'/g)
    ).toHaveLength(4);
    expect(migration.match(/integration\.is_active = true/g)).toHaveLength(4);
  });
});
