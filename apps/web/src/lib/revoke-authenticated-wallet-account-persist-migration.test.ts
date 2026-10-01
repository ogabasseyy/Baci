import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903211000_revoke_authenticated_wallet_account_persist.sql'
  ),
  'utf8'
);

describe('revoke authenticated wallet account persist migration', () => {
  it('keeps wallet account persistence on the service-role boundary', () => {
    expect(sql).toContain("auth.role()), '') <> 'service_role'");
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('TO service_role;');
    expect(sql).not.toContain('TO service_role, authenticated');
  });
});
