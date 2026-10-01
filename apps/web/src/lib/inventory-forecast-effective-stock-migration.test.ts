import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260827010001_use_effective_inventory_forecast_stock.sql'
  ),
  'utf8'
);

describe('inventory forecast effective stock migration', () => {
  it('uses the shared legacy/new stock fallback in the guarded dashboard RPC', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.get_inventory_forecast_dashboard('
    );
    expect(migration).toContain('GREATEST(');
    expect(migration).toContain('WHEN p.stock_quantity IS NULL');
    expect(migration).toContain('COALESCE(p.stock_quantity, 0) = 0');
    expect(migration).toContain('AND COALESCE(p.stock, 0) > 0 THEN p.stock');
    expect(migration).toContain('ELSE p.stock_quantity');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_inventory_forecast_dashboard'
    );
  });
});
