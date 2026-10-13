import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260825190000_bulk_inventory_forecast_dashboard.sql';
const migrationBytes = readFileSync(
  resolve(process.cwd(), `../../supabase/migrations/${migrationName}`)
);
const migration = migrationBytes.toString('utf8');
const migrationHash =
  'd38466b8daa79ac75dd96d0ee5e52039c62074cfaabf1ee326cbf3fb7f9f9a03';

describe('bulk inventory forecast dashboard migration', () => {
  it('uses one bounded tenant-authorized aggregation instead of per-product RPCs', () => {
    expect(migration).toContain('get_inventory_forecast_dashboard');
    expect(migration).toContain(
      "public.check_staff_permission(\n       (SELECT auth.uid()), p_merchant_id, 'products', 'view'"
    );
    expect(migration).toContain('p_limit > 100');
    expect(migration.match(/FROM public\.order_items/g)).toHaveLength(1);
    expect(migration).not.toContain('calculate_inventory_forecast(');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_inventory_forecast_dashboard'
    );
    expect(migration).toContain('FROM PUBLIC, anon;');
  });

  it('byte-freezes the append-only migration in both replay inventories', () => {
    const replaySources = readFileSync(
      resolve(
        process.cwd(),
        'tools/db/supabase-history-replay-inventory-pending-sources.ts'
      ),
      'utf8'
    );
    const recentSources = readFileSync(
      resolve(process.cwd(), 'tools/db/recent-pending-sources.test-fixture.ts'),
      'utf8'
    );

    expect(createHash('sha256').update(migrationBytes).digest('hex')).toBe(
      migrationHash
    );
    for (const inventory of [replaySources, recentSources]) {
      expect(inventory).toContain(migrationName);
      expect(inventory).toContain(migrationHash);
    }
  });
});
