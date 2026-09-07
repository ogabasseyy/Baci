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

it('restores case-insensitive tracking lookup via a lower(slug) expression index', () => {
  const migration = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../../../../supabase/migrations/20260907184500_order_tracking_slug_lower_expression_index.sql'
    ),
    'utf8'
  );

  expect(migration).toContain(
    'CREATE INDEX IF NOT EXISTS idx_merchants_slug_lower ON public.merchants ((lower(slug)))'
  );
  expect(migration).toContain(
    'WHERE lower(m.slug) = lower(trim(p_merchant_slug))'
  );
});
