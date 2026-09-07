import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('looks up merchants by indexed slug equality with a lowercased parameter', () => {
  const migration = readFileSync(
    resolve(
      '../../supabase/migrations/20260907183000_index_friendly_order_tracking_merchant_slug.sql'
    ),
    'utf8'
  );

  expect(migration).toContain('WHERE m.slug = lower(trim(p_merchant_slug))');
  expect(migration).not.toContain(
    'WHERE lower(m.slug) = lower(trim(p_merchant_slug))'
  );
});
