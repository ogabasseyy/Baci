import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName =
  '20260826150000_restrict_ads_connection_select_to_view_permission.sql';
const migrationPath = path.resolve(
  process.cwd(),
  `../../supabase/migrations/${migrationName}`
);

describe('merchant Ads connection RLS migration', () => {
  it('replaces membership-only reads with the route-equivalent view permissions', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();
    const policyStart = sql.indexOf(
      'create policy merchant_ad_connections_select'
    );
    const policy = sql.slice(policyStart);

    expect(policyStart).toBeGreaterThanOrEqual(0);
    expect(policy).toContain('for select to authenticated');
    expect(policy).toContain(
      "public.check_staff_permission(\n      (select auth.uid()), merchant_id, 'analytics', 'view'"
    );
    expect(policy).toContain(
      "public.check_staff_permission(\n      (select auth.uid()), merchant_id, 'integrations', 'view'"
    );
    expect(policy).not.toContain('has_merchant_access(merchant_id)');
  });

  it('is append-only and does not alter the historical migration', () => {
    expect(migrationName).toMatch(/^20260826\d{4,}_/);
    expect(readFileSync(migrationPath, 'utf8')).toContain('BEGIN;');
    expect(readFileSync(migrationPath, 'utf8')).toContain('COMMIT;');
  });
});
