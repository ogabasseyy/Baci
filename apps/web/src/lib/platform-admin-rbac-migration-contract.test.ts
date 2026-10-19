import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260805150000_platform_admin_rbac.sql'
  ),
  'utf8'
).toLowerCase();

describe('platform admin RBAC migration contract', () => {
  it('keeps platform memberships separate from merchant staff with no direct access', () => {
    expect(migrationSql).toContain(
      'create table if not exists public.platform_admin_memberships'
    );
    expect(migrationSql).toContain(
      'alter table public.platform_admin_memberships enable row level security'
    );
    expect(migrationSql).toContain(
      'revoke all on table public.platform_admin_memberships\n  from public, anon, authenticated, service_role'
    );
    expect(migrationSql).not.toContain('references public.staff_members');
    expect(migrationSql).toContain('reason text not null');
    expect(migrationSql).toContain(
      'granted_at timestamptz not null default now()'
    );
  });

  it('resolves multiple legacy merchant owners with EXISTS rather than a scalar lookup', () => {
    expect(migrationSql).toContain('if exists (');
    expect(migrationSql).toContain('merchant.is_platform_admin is true');
    expect(migrationSql).not.toContain(
      'merchant.is_platform_admin is true\n  limit 1'
    );
  });

  it('keeps revoked memberships out of live context and exposes only a minimal DTO', () => {
    expect(migrationSql).toContain("membership.status = 'active'");
    expect(migrationSql).toContain('membership.revoked_at is null');
    expect(migrationSql).toContain(
      'function public.get_platform_admin_context_v1()'
    );
    expect(migrationSql).toContain(
      'returns table (\n  role text,\n  permissions text[]'
    );
    expect(migrationSql).toContain(
      'function private.has_platform_admin_permission_v1('
    );
    expect(migrationSql).toContain("'roles.manage'");
  });

  it('hardens both helper functions and the public wrapper', () => {
    expect(migrationSql).toContain("set search_path = ''");
    expect(migrationSql).toContain(
      'revoke all on function private.get_platform_admin_context_v1(uuid)'
    );
    expect(migrationSql).toContain(
      'revoke all on function private.has_platform_admin_permission_v1(uuid, text)'
    );
    expect(migrationSql).toContain(
      'grant execute on function public.get_platform_admin_context_v1()\n  to authenticated'
    );
  });
});
