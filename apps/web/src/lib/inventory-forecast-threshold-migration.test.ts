import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName =
  '20260827110100_preserve_zero_inventory_threshold.sql' as const;
const migration = readFileSync(
  resolve(process.cwd(), `../../supabase/migrations/${migrationName}`),
  'utf8'
);

describe('inventory forecast threshold migration', () => {
  it('defaults only NULL thresholds and preserves an explicit zero', () => {
    expect(migration).toContain('COALESCE(p.low_stock_threshold, 5)::integer');
    expect(migration).not.toContain('NULLIF(p.low_stock_threshold, 0)');
  });

  it('replaces the guarded dashboard function without widening execution access', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.get_inventory_forecast_dashboard('
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_inventory_forecast_dashboard'
    );
    expect(migration).toContain(
      ') FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.get_inventory_forecast_dashboard('
    );
  });
});
