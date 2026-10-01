import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260828090000_allow_staff_dashboard_preferences.sql';
const migrationPath = path.resolve(
  process.cwd(),
  `../../supabase/migrations/${migrationName}`
);

describe('dashboard preferences staff RLS migration', () => {
  it('allows only settings viewers/editors to read and settings editors to write', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('create policy dashboard_preferences_staff_select');
    expect(sql).toContain('for select\n  to authenticated');
    expect(sql).toMatch(
      /dashboard_preferences_staff_select[\s\S]*?'settings',[\s\S]*?'view'[\s\S]*?'settings',[\s\S]*?'edit'/
    );

    expect(sql).toContain('create policy dashboard_preferences_staff_insert');
    expect(sql).toContain('create policy dashboard_preferences_staff_update');
    expect(sql).toMatch(
      /dashboard_preferences_staff_insert[\s\S]*?'settings',[\s\S]*?'edit'/
    );
    expect(sql).toMatch(
      /dashboard_preferences_staff_update[\s\S]*?'settings',[\s\S]*?'edit'/
    );
    expect(sql).toContain('with check');
    expect(sql).not.toContain('has_merchant_access');
  });

  it('keeps the migration append-only and transactional', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(migrationName).toMatch(/^20260828\d{4,}_/);
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('DROP POLICY IF EXISTS');
  });
});
