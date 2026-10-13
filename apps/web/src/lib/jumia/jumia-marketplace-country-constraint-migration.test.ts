import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationPath =
  '../../../../../supabase/migrations/20260831125000_align_jumia_marketplace_country_constraint.sql';

describe('Jumia marketplace country constraint migration', () => {
  it('scopes the replacement constraint before the follow-up migration runs', async () => {
    const sql = await readFile(new URL(migrationPath, import.meta.url), 'utf8');

    expect(sql).toMatch(
      /ADD CONSTRAINT marketplace_integrations_country_code_check[\s\S]*CHECK \(\s*platform IS DISTINCT FROM 'jumia'::text/i
    );
    expect(sql).not.toMatch(/CHECK \(\s*country_code\s*=\s*ANY\s*\(/i);
  });

  it('keeps country validation for non-Jumia integrations in the final form', async () => {
    const scopedMigrationPath =
      '../../../../../supabase/migrations/20260831130000_scope_jumia_marketplace_country_constraint.sql';
    const sql = await readFile(
      new URL(scopedMigrationPath, import.meta.url),
      'utf8'
    );

    expect(sql).toMatch(
      /platform\s*=\s*'jumia'::text\s*AND\s*country_code\s*=\s*ANY/i
    );
    expect(sql).toMatch(
      /platform\s+IS DISTINCT FROM\s+'jumia'::text\s*AND\s*country_code\s*=\s*ANY/i
    );
    expect(sql).not.toMatch(
      /platform\s+IS DISTINCT FROM\s+'jumia'::text\s*OR\s*country_code/i
    );
  });
});
