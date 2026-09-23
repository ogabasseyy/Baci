import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('adds tax while preserving all tracking authorization and response logic', () => {
  const original = readFileSync(
    resolve(
      '../../supabase/migrations/20260627164247_include_order_item_condition_in_tracking_rpc.sql'
    ),
    'utf8'
  );
  const migration = readFileSync(
    resolve(
      '../../supabase/migrations/20260907180000_include_tracking_order_tax.sql'
    ),
    'utf8'
  );
  const unchanged = migration
    .replace(
      'BEGIN;\n\nDROP FUNCTION IF EXISTS public.get_order_tracking(TEXT, UUID, TEXT, TEXT, TEXT);\n\n',
      ''
    )
    .replace('  tax_amount NUMERIC,\n', '')
    .replace('    o.tax_amount,\n', '')
    .replace('\nCOMMIT;\n', '');
  expect(unchanged).toBe(original);
  expect(migration).toContain('  tax_amount NUMERIC,');
  expect(migration).toContain('    o.tax_amount,');
});
