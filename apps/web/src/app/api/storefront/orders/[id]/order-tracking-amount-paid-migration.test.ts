import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../../supabase/migrations'
);

it('adds amount_paid while preserving tracking authorization and response logic', () => {
  const original = readFileSync(
    resolve(
      migrationsDir,
      '20260908010000_include_tracking_order_gift_wrapping_fee.sql'
    ),
    'utf8'
  );
  const migration = readFileSync(
    resolve(
      migrationsDir,
      '20260921130000_include_tracking_order_amount_paid.sql'
    ),
    'utf8'
  );
  const unchanged = migration
    .replace(
      'BEGIN;\n\n-- Guest success pages need the persisted credited amount to reconcile payer\n-- instructions with orders.total (partial wallet/savings coverage).\nDROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);\n\n',
      'BEGIN;\n\n-- Resume/deep-link checkout summaries need the persisted gift-wrapping fee to\n-- reconcile with orders.total (tax/discount already ship through this RPC).\nDROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);\n\n'
    )
    .replace('  amount_paid NUMERIC,\n', '')
    .replace('    o.amount_paid,\n', '');
  expect(unchanged).toBe(original);
  expect(migration).toContain('  amount_paid NUMERIC,');
  expect(migration).toContain('    o.amount_paid,');
  expect(migration).toContain(
    'DROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);'
  );
});
