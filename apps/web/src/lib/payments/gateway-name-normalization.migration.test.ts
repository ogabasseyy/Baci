import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183650_gateway_name_normalization.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('gateway name normalization helper migration', () => {
  it('creates an immutable trim/case normalizer', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.normalized_gateway_name_v1('
    );
    // Immutable so candidate-selection partial indexes can key on it.
    expect(migrationSql).toContain('LANGUAGE sql IMMUTABLE');
    expect(migrationSql).toContain(
      "COALESCE(p_gateway, ''), '^\\s+|\\s+$', '', 'g'"
    );
  });
});
