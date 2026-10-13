import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');

function readMigration(filename: string) {
  return readFileSync(
    resolve(repositoryRoot, 'supabase/migrations', filename),
    'utf8'
  );
}

function readMigrationTest(filename: string) {
  return readFileSync(
    resolve(repositoryRoot, 'supabase/migrations/tests', filename),
    'utf8'
  );
}

describe('repair pickup Codex review hardenings', () => {
  it('lets paid fulfillment read unpublished or pickup-disabled receivers', () => {
    const sql = readMigration(
      '20260905140200_fulfill_paid_repair_pickup_receiver.sql'
    );
    expect(sql).toContain("NOT IN ('server-quote', 'server-fulfillment')");
    expect(sql).toContain(
      "auth.jwt() ->> 'repair_pickup_receiver_context' = 'server-fulfillment'"
    );
    expect(sql).toContain('COALESCE(merchant.is_published, false)');
    expect(
      readMigrationTest('repair_pickup_receiver_fulfillment.sql')
    ).toContain('fulfillment JWT did not receive unpublished repair-center');
    expect(
      readMigrationTest('repair_pickup_receiver_fulfillment.sql')
    ).toContain('quote JWT received an unpublished repair-center projection');
  });

  it('restores failed-event recovery, delivered_at, and manual-failed terminality', () => {
    const sql = readMigration(
      '20260905140000_restore_gigl_repair_pickup_tracking_hardening.sql'
    );
    expect(sql).toContain("WHEN v_current_status = ''failed''");
    expect(sql).toContain(
      "p_status IN (''picked_up'', ''in_transit'', ''out_for_delivery'')"
    );
    expect(sql).toContain(
      "v_should_update_delivery := v_effective_status = ''delivered''"
    );
    expect(sql).toContain('v_manual_terminal_failed');
    expect(sql).toContain('OR v_manual_terminal_failed');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).toContain(
      'v_latest_status_event_at <= v_manual_terminal_override_at'
    );
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION public.apply_gigl_tracking_result'
    );
  });

  it('re-evaluates orderless monitors when the repair link disappears', () => {
    const sql = readMigration(
      '20260905140100_retire_orderless_gigl_monitors_without_repair.sql'
    );
    expect(sql).toContain(
      'AND (NEW.order_id IS NOT NULL OR v_is_repair_linked) THEN'
    );
    expect(
      readMigration(
        '20260905140300_gigl_monitor_fast_path_merchant_identity.sql'
      )
    ).toContain('AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id');
    expect(
      readMigration(
        '20260905140300_gigl_monitor_fast_path_merchant_identity.sql'
      )
    ).toContain('AND (v_order_is_owned OR v_is_repair_linked) THEN');
  });
});
