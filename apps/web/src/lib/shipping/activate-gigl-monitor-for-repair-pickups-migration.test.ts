import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904190100_activate_gigl_monitor_for_repair_pickups.sql'
);

describe('activate_gigl_monitor_for_repair_pickups migration', () => {
  it('allows null-order monitors when the shipment is linked to a repair', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain(
      'ALTER TABLE public.shipment_tracking_monitors\n  ALTER COLUMN order_id DROP NOT NULL'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.activate_gigl_tracking_monitor()'
    );
    expect(sql).toContain('FROM public.repairs AS repair');
    expect(sql).toContain('repair.shipment_id = NEW.id');
    expect(sql).toContain('v_is_repair_linked');
    expect(sql).toContain('(NEW.order_id IS NULL AND NOT v_is_repair_linked)');
    expect(sql).toContain('tracking_timeline_generation >= 0');
  });
});
