import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('apply GIGL tracking for orderless repair pickups migration', () => {
  it('null-safes shipment identity and allows merchant-only orderless outbox rows', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260904190200_apply_gigl_tracking_orderless_repair_pickups.sql'
      ),
      'utf8'
    );

    expect(migration).toContain(
      'ALTER TABLE public.shipment_tracking_notification_outbox'
    );
    expect(migration).toContain('ALTER COLUMN order_id DROP NOT NULL');
    expect(migration).toContain(
      'shipment.order_id IS NOT DISTINCT FROM v_order_id'
    );
    expect(migration).toContain(
      "(shipment.order_id IS NOT NULL OR policy.audience = 'merchant')"
    );
  });
});

describe('fix GIGL tracking notification conflict target migration', () => {
  it('rewrites column-list ON CONFLICT to bare exclusion for partial indexes', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260904190550_fix_gigl_tracking_notification_conflict_target.sql'
      ),
      'utf8'
    );

    expect(migration).toContain('ON CONFLICT DO NOTHING');
    expect(migration).toContain('pg_get_functiondef');
    expect(migration).toContain(
      'apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)'
    );
    expect(migration).toContain(
      'shipment_id, tracking_epoch_id, tracking_event_id, audience, notification_kind'
    );
  });
});

describe('claim GIGL tracking notifications repair_id migration', () => {
  it('projects repair_id for orderless claims without widening worker table access', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260904190650_claim_gigl_tracking_notifications_repair_id.sql'
      ),
      'utf8'
    );

    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS public.claim_shipment_tracking_notifications'
    );
    expect(migration).toContain('repair_id uuid');
    expect(migration).toContain('FROM public.repairs AS candidate');
    expect(migration).toContain('claimed.order_id IS NULL');
  });
});
