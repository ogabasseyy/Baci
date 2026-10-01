import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151440_harden_platform_settings_secret_access.sql'
);

describe('platform settings secret access migration contract', () => {
  it('denies direct authenticated secret reads while retaining only safe columns', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const grant =
      sql.match(
        /GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.platform_settings TO authenticated;/
      )?.[1] ?? '';

    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.platform_settings FROM anon, authenticated;'
    );
    expect(sql).toContain('REVOKE SELECT (\n  ga4_api_secret');
    expect(grant).toContain('platform_name');
    expect(grant).not.toContain('ga4_api_secret');
    expect(grant).not.toContain('facebook_capi_token');
    expect(grant).not.toContain('tiktok_access_token');
    expect(grant).not.toContain('snapchat_capi_token');
    expect(sql).toContain("'settings.read'");
    expect(sql).toContain('get_admin_platform_settings_v1()');
  });

  it('allows writes only through a permission-gated whitelist that excludes structural fields', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const whitelist =
      sql.match(/WHERE key NOT IN \(([\s\S]*?)\)\n {2}\) THEN/)?.[1] ?? '';

    expect(sql).not.toContain(
      'GRANT UPDATE ON TABLE public.platform_settings TO authenticated;'
    );
    expect(sql).toContain(
      'REVOKE UPDATE (id, singleton_key, created_at, updated_at)'
    );
    expect(sql).toContain("'settings.manage'");
    expect(sql).toContain(
      'update_admin_platform_settings_v1(p_settings jsonb)'
    );
    expect(whitelist).not.toContain("'id'");
    expect(whitelist).not.toContain("'singleton_key'");
    expect(whitelist).not.toContain("'created_at'");
    expect(whitelist).not.toContain("'updated_at'");
    expect(sql).toContain('ALTER COLUMN singleton_key SET NOT NULL');
  });

  it('revalidates bounded identifiers, secrets, and fees inside the RPC', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('invalid_platform_settings_text_length');
    expect(sql).toContain('char_length(btrim(value)) NOT BETWEEN 1 AND 50');
    expect(sql).toContain(
      "char_length(p_settings ->> 'ga4_api_secret') NOT BETWEEN 1 AND 100"
    );
    expect(sql).toContain('invalid_platform_settings_fee');
    expect(sql).toContain(
      'v_input.platform_fee_percentage NOT BETWEEN 0 AND 100'
    );
    expect(sql).toContain('invalid_platform_settings_name');
    expect(sql).toContain('invalid_platform_settings_contact_or_message');
    expect(sql).toContain('invalid_platform_settings_boolean');
  });
});
