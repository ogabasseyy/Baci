import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260805151650_preserve_dual_role_notification_merchants.sql'
  ),
  'utf8'
).toLowerCase();

describe('admin notification dual-role merchant migration', () => {
  it('keeps user-backed merchants eligible regardless of platform-admin role', () => {
    expect(migration).toContain(
      'create or replace function public.get_admin_notification_segment_merchant_ids'
    );
    expect(migration).toContain(
      'create or replace function public.snapshot_claimed_notification_audience_v1'
    );
    expect(migration).toContain('where m.user_id is not null');
    expect(migration).not.toContain('m.is_platform_admin');
  });

  it('retains a pinned, service-role-only execution boundary', () => {
    expect(migration.match(/security definer/g)).toHaveLength(2);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(2);
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
  });
});
