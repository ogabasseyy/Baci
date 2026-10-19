import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260826130000_add_follow_up_notification_preference.sql'
  ),
  'utf8'
);
const preferenceRpcMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260826140000_read_follow_up_notification_preference_rpc.sql'
  ),
  'utf8'
);
const invoiceBoundPreferenceRpcMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260827080000_bind_follow_up_notification_preference_to_invoice.sql'
  ),
  'utf8'
);

describe('follow-up notification preference migration', () => {
  it('opts existing and new merchants into follow-up alerts by default', () => {
    expect(migrationSql).toContain(
      'ADD COLUMN IF NOT EXISTS follow_up_notifications_enabled boolean'
    );
    expect(migrationSql).toContain('NOT NULL DEFAULT true');
  });

  it('documents the preference as an event-driven follow-up alert control', () => {
    expect(migrationSql).toContain(
      'event-driven alerts for actionable customer follow-up items'
    );
  });

  it('exposes only the follow-up switch to guest checkout through a bounded RPC', () => {
    expect(preferenceRpcMigrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.get_follow_up_notification_preference('
    );
    expect(preferenceRpcMigrationSql).toContain('RETURNS boolean');
    expect(preferenceRpcMigrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_follow_up_notification_preference(uuid)'
    );
    expect(preferenceRpcMigrationSql).toContain(
      'TO anon, authenticated, service_role'
    );
  });

  it('binds the preference read to an existing unpaid invoice order', () => {
    expect(invoiceBoundPreferenceRpcMigrationSql).toContain(
      'DROP FUNCTION IF EXISTS public.get_follow_up_notification_preference(uuid)'
    );
    expect(invoiceBoundPreferenceRpcMigrationSql).toContain('p_order_id uuid');
    expect(invoiceBoundPreferenceRpcMigrationSql).toContain(
      "invoice_order.payment_method = 'invoice'"
    );
    expect(invoiceBoundPreferenceRpcMigrationSql).toContain(
      "invoice_order.payment_status IS DISTINCT FROM 'paid'"
    );
    expect(invoiceBoundPreferenceRpcMigrationSql).toContain(
      'TO anon, authenticated, service_role'
    );
  });
});
