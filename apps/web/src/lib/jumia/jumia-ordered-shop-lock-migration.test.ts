import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../../supabase/migrations/20260825000400_order_jumia_multi_shop_locks.sql'
  ),
  'utf8'
);

describe('ordered Jumia multi-shop lock migration', () => {
  it('locks distinct provider shops in sorted order before persistence', () => {
    expect(migration).toContain('SELECT DISTINCT btrim(selected.shop_id)');
    expect(migration).toContain('ORDER BY btrim(selected.shop_id)');
    expect(migration.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      migration.indexOf('public.persist_jumia_self_authorization(')
    );
  });
});
