import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    '../../supabase/migrations/20260805150800_platform_admin_public_read_models.sql'
  ),
  'utf8'
).toLowerCase();

describe('platform admin public read-model migration', () => {
  it('bridges RLS through a current-user permission check', () => {
    expect(migration).toContain(
      'function public.current_user_has_platform_admin_permission_v1'
    );
    expect(migration).toContain("'settings.read'");
    expect(migration).toContain("'settings.manage'");
    expect(migration).not.toContain(
      'grant execute on function private.has_platform_admin_permission_v1'
    );
  });

  it('exposes only public analytics identifiers to anonymous callers', () => {
    const publicFunction = migration.slice(
      migration.indexOf(
        'function public.get_public_platform_analytics_config_v1'
      )
    );

    expect(publicFunction).toContain('google_analytics_id');
    expect(publicFunction).toContain('facebook_pixel_id');
    expect(publicFunction).not.toContain('ga4_api_secret');
    expect(publicFunction).not.toContain('facebook_capi_token');
    expect(publicFunction).not.toContain('tiktok_access_token');
    expect(publicFunction).toContain('to anon, authenticated');
  });

  it('audits settings changes atomically without recording values', () => {
    expect(migration).toContain('trigger audit_platform_settings_update_v1');
    expect(migration).toContain("'platform_settings.updated'");
    expect(migration).toContain('is distinct from old.ga4_api_secret');
    expect(migration).not.toContain(
      "jsonb_build_object(\n      'ga4_api_secret'"
    );
  });
});
