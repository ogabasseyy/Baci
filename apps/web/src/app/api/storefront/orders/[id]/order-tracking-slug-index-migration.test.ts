import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('looks up merchants by indexed slug equality with a lowercased parameter', () => {
  const migration = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../../../../supabase/migrations/20260907183000_index_friendly_order_tracking_merchant_slug.sql'
    ),
    'utf8'
  );

  expect(migration).toContain('WHERE m.slug = lower(trim(p_merchant_slug))');
  expect(migration).not.toContain(
    'WHERE lower(m.slug) = lower(trim(p_merchant_slug))'
  );
});

it('restores case-insensitive tracking lookup via lower(slug)', () => {
  const migration = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../../../../supabase/migrations/20260907184500_order_tracking_slug_lower_expression_index.sql'
    ),
    'utf8'
  );

  expect(migration).toContain(
    'WHERE lower(m.slug) = lower(trim(p_merchant_slug))'
  );
  expect(migration).not.toContain('CREATE INDEX');
});

it('creates the lower(slug) expression index concurrently outside a transaction', () => {
  const migration = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../../../../supabase/migrations/20260907184600_merchants_slug_lower_expression_index_concurrently.sql'
    ),
    'utf8'
  );

  expect(migration.startsWith('-- disable-transaction\n')).toBe(true);
  expect(migration).toContain(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_slug_lower'
  );
});
