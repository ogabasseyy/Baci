import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../supabase/migrations'
);

it('adds gift_wrapping_fee while preserving tracking authorization and response logic', () => {
  const original = readFileSync(
    resolve(
      migrationsDir,
      '20260907184500_order_tracking_slug_lower_expression_index.sql'
    ),
    'utf8'
  );
  const migration = readFileSync(
    resolve(
      migrationsDir,
      '20260908010000_include_tracking_order_gift_wrapping_fee.sql'
    ),
    'utf8'
  );
  const unchanged = migration
    .replace(
      'BEGIN;\n\n-- Resume/deep-link checkout summaries need the persisted gift-wrapping fee to\n-- reconcile with orders.total (tax/discount already ship through this RPC).\nDROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);\n\n',
      'BEGIN;\n\n-- Case-insensitive merchant slug lookup. The matching expression index is\n-- created concurrently in a sibling non-transactional migration.\n'
    )
    .replace('  gift_wrapping_fee NUMERIC,\n', '')
    .replace('    o.gift_wrapping_fee,\n', '');
  expect(unchanged).toBe(original);
  expect(migration).toContain('  gift_wrapping_fee NUMERIC,');
  expect(migration).toContain('    o.gift_wrapping_fee,');
  expect(migration).toContain(
    'DROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);'
  );
});
