import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260827020001_prioritize_inventory_status_before_limit.sql'
  ),
  'utf8'
);

describe('inventory forecast status ordering migration', () => {
  it('orders every actionable status before healthy rows before applying the limit', () => {
    const pageRowsOrder = migration.indexOf(
      "    ORDER BY\n      CASE stock_status\n        WHEN 'out_of_stock' THEN 0\n        WHEN 'critical' THEN 1\n        WHEN 'warning' THEN 2\n        ELSE 3"
    );
    const pageRowsLimit = migration.indexOf('    LIMIT p_limit', pageRowsOrder);

    expect(pageRowsOrder).toBeGreaterThanOrEqual(0);
    expect(pageRowsLimit).toBeGreaterThan(pageRowsOrder);
    expect(migration).toContain(
      "CASE r.stock_status\n            WHEN 'out_of_stock' THEN 0\n            WHEN 'critical' THEN 1\n            WHEN 'warning' THEN 2\n            ELSE 3"
    );
    expect(migration).toContain('OFFSET p_offset');
  });
});
