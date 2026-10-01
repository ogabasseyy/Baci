import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260825000800_require_legacy_jumia_self_authorization_reconnect.sql'
  ),
  'utf8'
);

describe('legacy Jumia self-authorization reconnect migration', () => {
  it('deactivates only unmigratable plaintext legacy grants and clears their refresh credential', () => {
    expect(migration).toContain("connection_method = 'oauth'");
    expect(migration).toContain('jumia_authorization_id IS NULL');
    expect(migration).toContain('access_token IS NULL');
    expect(migration).toContain('refresh_token IS NOT NULL');
    expect(migration).toContain('token_expires_at IS NULL');
    expect(migration).toContain('is_active = false');
    expect(migration).toContain('refresh_token = NULL');
    expect(migration).toContain(
      "sync_error = 'Reconnect Jumia to continue background synchronization'"
    );
  });
});
