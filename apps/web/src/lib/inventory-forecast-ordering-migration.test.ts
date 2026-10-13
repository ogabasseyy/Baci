import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName =
  '20260826160000_prioritize_out_of_stock_inventory_forecast.sql' as const;
const migration = readFileSync(
  resolve(process.cwd(), `../../supabase/migrations/${migrationName}`),
  'utf8'
);
const normalizedMigration = migration.replace(/\s+/g, ' ').trim();

describe('inventory forecast ordering migration', () => {
  it('prioritizes no-sales out-of-stock rows before applying the page limit', () => {
    const pageOrder =
      'ORDER BY CASE WHEN current_stock <= 0 THEN 0 ELSE 1 END ASC, days_of_stock ASC, product_id ASC';
    const pageOrderIndex = normalizedMigration.indexOf(pageOrder);
    const pageLimitIndex = normalizedMigration.indexOf(
      'LIMIT p_limit',
      pageOrderIndex
    );

    expect(pageOrderIndex).toBeGreaterThanOrEqual(0);
    expect(pageLimitIndex).toBeGreaterThan(pageOrderIndex);
    expect(normalizedMigration).toContain(
      'ORDER BY CASE WHEN r.current_stock <= 0 THEN 0 ELSE 1 END ASC, r.days_of_stock ASC, r.product_id ASC'
    );
  });

  it('preserves explicit zero thresholds while retaining the guarded function', () => {
    expect(migration).toContain('COALESCE(p.low_stock_threshold, 5)::integer');
    expect(migration).not.toContain('NULLIF(p.low_stock_threshold, 0)');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_inventory_forecast_dashboard'
    );
  });
});
