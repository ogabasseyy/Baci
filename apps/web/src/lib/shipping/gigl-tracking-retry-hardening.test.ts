import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readMigration(filename: string) {
  const modulePath = fileURLToPath(import.meta.url).replace(/^\/@fs(?=\/)/, '');
  return readFileSync(
    resolve(
      dirname(modulePath),
      `../../../../../supabase/migrations/${filename}`
    ),
    'utf8'
  );
}

function readMigrationTest(filename: string) {
  const modulePath = fileURLToPath(import.meta.url).replace(/^\/@fs(?=\/)/, '');
  return readFileSync(
    resolve(
      dirname(modulePath),
      `../../../../../supabase/migrations/tests/${filename}`
    ),
    'utf8'
  );
}

function expectReplacementDirection(
  source: string,
  original: string,
  replacement: string
) {
  const originalOffset = source.indexOf(original);
  expect(originalOffset).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(replacement)).toBeGreaterThan(originalOffset);
}

describe('GIGL retry and generation hardening migrations', () => {
  it('preserves failures and allows newer nonterminal recovery observations', () => {
    expect(
      readMigration('20260801141300_allow_gigl_retry_recovery_states.sql')
    ).toContain("WHEN 'failed' THEN 0");
    const followUp = readMigration(
      '20260801141800_harden_gigl_tracking_retry_edges.sql'
    );
    expect(followUp).toContain("WHEN 'failed' THEN 5");
    expect(followUp).toContain(
      "p_status IN (''picked_up'', ''in_transit'', ''out_for_delivery'')"
    );
    expect(readMigrationTest('gigl_tracking_retry_recovery.sql')).toContain(
      'a newer nonterminal GIGL scan must recover a failed shipment'
    );
    expect(
      readMigrationTest('gigl_tracking_failure_transitions.sql')
    ).toContain('a newer GIGL failure must remain visible after transit');
    const repair = readMigration(
      '20260803000700_repair_gigl_tracking_retry_edges.sql'
    );
    expect(repair).toContain(
      "|| '          > NEW.tracking_timeline_generation'"
    );
    expect(repair).toContain(
      "|| E'        v_latest_persisted_event_at IS NULL\\n'"
    );
    expect(repair).toContain(
      "v_definition NOT LIKE '%newer_shipment.merchant_id = NEW.merchant_id%'"
    );
    expect(repair).toContain('pg_catalog.regexp_count');
  });

  it('ignores obsolete shipment generations when syncing order status', () => {
    expect(
      readMigration(
        '20260801141400_scope_gigl_order_status_to_latest_generation.sql'
      )
    ).toContain('newer_shipment.tracking_timeline_generation');
    expect(
      readMigrationTest('gigl_tracking_order_status_generation.sql')
    ).toContain(
      'an unowned newer GIGL shipment must not block the victim order'
    );
    expect(
      readMigration('20260801141800_harden_gigl_tracking_retry_edges.sql')
    ).toContain('newer_shipment.merchant_id = NEW.merchant_id');
  });

  it('keeps delivery timestamp coverage isolated from notification ordering', () => {
    expect(readMigrationTest('gigl_tracking_delivery_timestamp.sql')).toContain(
      'a stale GIGL delivery timestamp must not replace the persisted timestamp'
    );
    expect(
      readMigrationTest('gigl_tracking_notification_order.sql')
    ).not.toContain(
      'a stale GIGL delivery timestamp must not replace the persisted timestamp'
    );
    expect(readMigrationTest('gigl_tracking_delivery_timestamp.sql')).toContain(
      'cancelled GIGL shipments must not receive delivery metadata'
    );
    expect(
      readMigration('20260801141800_harden_gigl_tracking_retry_edges.sql')
    ).toContain(
      "v_should_update_delivery := v_effective_status = ''delivered''"
    );
    expect(
      readMigration(
        '20260905140000_restore_gigl_repair_pickup_tracking_hardening.sql'
      )
    ).toContain(
      "v_should_update_delivery := v_effective_status = ''delivered''"
    );
  });

  it('keeps milestone identities one-time while preserving retry attempt identity', () => {
    const identityMigration = readMigration(
      '20260801141500_scope_gigl_notification_identity.sql'
    );

    expect(identityMigration).toContain(
      "notification_kind NOT IN ('failed', 'delivery_attempt_failed')"
    );
    expect(identityMigration).toContain(
      'shipment_tracking_notifications_milestone_identity_key'
    );
    expect(identityMigration).toContain(
      'shipment_tracking_notifications_attempt_identity_key'
    );
    expect(identityMigration).toContain('ON CONFLICT DO NOTHING');
    expect(
      readMigrationTest('gigl_tracking_notification_identity.sql')
    ).toContain('GIGL notification identities keep milestones one-time');
  });

  it('records manual terminal overrides from retryable failures', () => {
    const overrideMigration = readMigration(
      '20260801141600_record_manual_gigl_failure_overrides.sql'
    );

    expect(overrideMigration).toContain("OLD.status = 'failed'");
    expect(overrideMigration).toContain(
      "NEW.status IN ('delivered', 'cancelled', 'returned')"
    );
    expect(
      readMigrationTest('gigl_tracking_manual_failure_override.sql')
    ).toContain(
      'manual terminal transitions from failed preserve override state'
    );
  });

  it('compares retry recovery with the persisted failed event', () => {
    const migration = readMigration(
      '20260801141900_scope_gigl_recovery_to_failed_event.sql'
    );

    expect(migration).toContain('v_latest_persisted_status_event_at');
    expectReplacementDirection(
      readMigration(
        '20260804000100_repair_gigl_failed_event_recovery_scope.sql'
      ),
      'v_latest_persisted_event_at IS NULL',
      'v_latest_persisted_status_event_at IS NULL'
    );
    expect(
      readMigrationTest('gigl_tracking_failure_transitions.sql')
    ).toContain(
      'a recovery between a failed event and newer unknown scan must replace the failure'
    );
  });

  it('keeps the superseded GIGL repair mapped to its corrected successor', () => {
    const repairSpec = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url).replace(/^\/@fs(?=\/)/, '')),
        '../../../../../.github/scripts/historical-migration-repair-spec.sh'
      ),
      'utf8'
    );

    expect(repairSpec).toMatch(
      /20260801142000:harden_gigl_notification_recovery_edges[\s\S]*'20260804000400' 'repair_gigl_notification_terminality_cardinality'/
    );
    expect(repairSpec).toMatch(
      /20260804000200:repair_gigl_notification_recovery_edges[\s\S]*'20260804000400' 'repair_gigl_notification_terminality_cardinality'/
    );
  });

  it('provides a service-only reset for definitively rejected push dispatches', () => {
    const dispatchMigration = readMigration(
      '20260801141700_reset_gigl_notification_dispatch_boundary.sql'
    );

    expect(dispatchMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.reset_shipment_tracking_notification_dispatch('
    );
    expect(dispatchMigration).toContain('delivery_started_at = NULL');
    expect(dispatchMigration).toContain('TO service_role');
  });

  it('cleans unowned monitors created by the initial backfill', () => {
    const migration = readMigration(
      '20260801142200_cleanup_unowned_gigl_monitor_backfill.sql'
    );
    const repair = readMigration(
      '20260803000200_repair_unowned_gigl_monitor_backfill.sql'
    );
    const retryRepair = readMigration(
      '20260804000500_repair_gigl_monitor_backfill_join.sql'
    );

    expect(migration).toContain('public.orders AS order_row');
    expect(migration).toContain(
      'JOIN public.orders AS order_row ON order_row.id = monitor.order_id'
    );
    expect(migration).toContain(
      'shipment.merchant_id IS DISTINCT FROM order_row.merchant_id'
    );
    expect(migration).toContain("SET state = 'inactive'");
    expect(repair).toContain('FROM public.shipments AS shipment,');
    expect(repair).toContain('order_row.id = monitor.order_id');
    expect(retryRepair).toContain('FROM public.shipments AS shipment,');
    expect(retryRepair).toContain('order_row.id = monitor.order_id');
    expect(retryRepair).not.toContain(
      'JOIN public.orders AS order_row ON order_row.id = monitor.order_id'
    );
  });

  it('keeps carrier precedence fixes append-only', () => {
    const migration = readMigration(
      '20260803000300_harden_gigl_carrier_precedence.sql'
    );

    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.reconcile_gigl_monitor_tenant('
    );
    expect(migration).toContain(
      'z_prevent_gigl_monitor_reactivation_after_carrier'
    );
    expect(migration).toContain('newer_shipment.tracking_timeline_generation');
    expect(migration).toContain(
      'PERFORM private.reconcile_gigl_monitor_tenant(v_order_id)'
    );
  });

  it('indexes every state eligible for GIGL monitor claims', () => {
    const migration = readMigration(
      '20260803000500_index_gigl_monitor_claims.sql'
    );

    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS shipment_tracking_monitors_claimable_due_idx'
    );
    expect(migration).toContain(
      "WHERE state IN ('active', 'final_poll', 'paused')"
    );
    expect(migration).toContain('next_poll_at IS NOT NULL');
  });

  it('revalidates monitor ownership when a shipment merchant changes', () => {
    const migration = readMigration(
      '20260801142300_track_gigl_monitor_merchant_changes.sql'
    );

    expect(migration).toContain(
      'UPDATE OF tracking_number, status, provider, order_id, merchant_id'
    );
    expect(migration).toContain(
      'activate_gigl_tracking_monitor ON public.shipments'
    );
  });
});
