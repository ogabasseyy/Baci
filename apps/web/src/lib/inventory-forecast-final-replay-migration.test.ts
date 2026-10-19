import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260827110200_restore_inventory_forecast_effective_stock_priority.sql'
  ),
  'utf8'
);

describe('inventory forecast final replay migration', () => {
  it('retains the effective stock fallback used by product update flows', () => {
    expect(migration).toContain('GREATEST(');
    expect(migration).toContain('WHEN p.stock_quantity IS NULL');
    expect(migration).toContain('WHEN COALESCE(p.stock_quantity, 0) = 0');
    expect(migration).toContain('AND COALESCE(p.stock, 0) > 0 THEN p.stock');
    expect(migration).toContain('ELSE p.stock_quantity');
  });

  it('orders actionable statuses before the page limit', () => {
    const orderIndex = migration.indexOf(
      "CASE stock_status\n        WHEN 'out_of_stock' THEN 0\n        WHEN 'critical' THEN 1\n        WHEN 'warning' THEN 2"
    );
    const limitIndex = migration.indexOf('LIMIT p_limit', orderIndex);

    expect(orderIndex).toBeGreaterThanOrEqual(0);
    expect(limitIndex).toBeGreaterThan(orderIndex);
    expect(migration).toContain(
      "CASE r.stock_status\n            WHEN 'out_of_stock' THEN 0\n            WHEN 'critical' THEN 1\n            WHEN 'warning' THEN 2"
    );
  });

  it('keeps the guarded RPC execution boundary', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_inventory_forecast_dashboard'
    );
    expect(migration).toContain(') FROM PUBLIC, anon;');
    expect(migration).toContain(') TO authenticated;');
  });
});
