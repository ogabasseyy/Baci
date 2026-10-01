import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modulePath = fileURLToPath(import.meta.url).replace(/^\/@fs(?=\/)/, '');
const repositoryRoot = resolve(dirname(modulePath), '../../../../../');

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

function expectReplacementDirection(
  source: string,
  original: string,
  replacement: string
) {
  const originalOffset = source.indexOf(original);
  expect(originalOffset).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(replacement)).toBeGreaterThan(originalOffset);
}

describe('GIGL manual failure hardening migrations', () => {
  it('supersedes the malformed recovery repair with the cardinality-checked replacement', () => {
    const followUp = readMigration(
      '20260801142000_harden_gigl_notification_recovery_edges.sql'
    );
    const repair = readMigration(
      '20260804000200_repair_gigl_notification_recovery_edges.sql'
    );
    const repairSpec = readFileSync(
      resolve(
        repositoryRoot,
        '.github/scripts/historical-migration-repair-spec.sh'
      ),
      'utf8'
    );

    expect(followUp).toContain(
      'DROP FUNCTION IF EXISTS public.reset_shipment_tracking_notification_dispatch'
    );
    expect(followUp).toContain(
      'NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id'
    );
    expect(followUp).toContain('v_manual_terminal_failed');
    expect(repair).toContain(
      "v_expected_scope :=\n    E'     AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id\\n'\n    || E'     AND NEW.merchant_id IS NOT DISTINCT FROM OLD.merchant_id THEN';"
    );
    expect(repair).toContain(
      "pg_catalog.replace(v_definition, v_expected_declaration, '')"
    );
    expect(repair).toContain(
      "pg_catalog.replace(v_definition, v_expected_assignment, '')"
    );
    expect(repair).toContain(
      "pg_catalog.replace(v_definition, v_expected_terminality, '')"
    );
    expect(repairSpec).toContain(
      "20260801142000:harden_gigl_notification_recovery_edges)\n      printf '%s\\t%s\\t%s\\n' '20260804000400' 'repair_gigl_notification_terminality_cardinality'"
    );
    expect(repairSpec).toContain(
      "20260804000200:repair_gigl_notification_recovery_edges)\n      printf '%s\\t%s\\t%s\\t%s\\n' '20260801142000' 'harden_gigl_notification_recovery_edges' '20260804000400' 'repair_gigl_notification_terminality_cardinality'"
    );
  });

  it('initializes manual failure terminality before the monitor fields are rewritten', () => {
    const terminalityRepair = readMigration(
      '20260804000400_repair_gigl_notification_terminality_cardinality.sql'
    );
    const historicalFunction = readMigration(
      '20260801141100_preserve_manual_gigl_terminal_overrides.sql'
    );

    expect(
      historicalFunction.match(
        /v_effective_status IN \('delivered', 'cancelled', 'returned'\)/g
      )
    ).toHaveLength(3);
    expect(historicalFunction).toContain(
      "SET state = CASE WHEN v_effective_status IN ('delivered', 'cancelled', 'returned')"
    );
    expect(historicalFunction).toContain(
      "next_poll_at = CASE WHEN v_effective_status IN ('delivered', 'cancelled', 'returned')"
    );
    expect(historicalFunction).toContain(
      "stopped_at = CASE WHEN v_effective_status IN ('delivered', 'cancelled', 'returned')"
    );
    expect(terminalityRepair).toContain('v_expected_monitor_terminality');
    expect(terminalityRepair).toContain('v_expected_next_poll_terminality');
    expect(terminalityRepair).toContain('v_expected_stopped_terminality');
    expect(terminalityRepair).toContain(
      "v_monitor_assignment :=\n    E'  UPDATE public.shipment_tracking_monitors AS monitor\\n'"
    );
    expect(terminalityRepair).toContain(
      'v_definition,\n    v_monitor_assignment,\n    v_manual_terminal_assignment || v_monitor_assignment'
    );
    expect(
      readMigrationTest('gigl_tracking_manual_failure_order_status.sql')
    ).toContain('manual failed final polls must remain terminal');
    expect(
      readMigrationTest('gigl_tracking_monitor_tenant_scope.sql')
    ).toContain(
      'changing a GIGL shipment merchant must deactivate its monitor'
    );
    expect(
      readMigration(
        '20260905140000_restore_gigl_repair_pickup_tracking_hardening.sql'
      )
    ).toContain('v_manual_terminal_failed');
  });

  it('does not require the skipped hardening output before applying its successor', () => {
    const terminalityRepair = readMigration(
      '20260804000400_repair_gigl_notification_terminality_cardinality.sql'
    );

    expect(terminalityRepair).toContain('v_manual_terminal_assignment :=');
    expect(terminalityRepair).toContain(
      'v_latest_incoming_event_at <= v_manual_terminal_override_at'
    );
    expect(terminalityRepair).not.toContain(
      'GIGL manual failure terminality scope is missing'
    );
  });

  it('keeps manual failures terminal when only unknown scans are newer', () => {
    const migration = readMigration(
      '20260801142100_preserve_manual_gigl_failures_after_unknown_scans.sql'
    );

    expect(migration).toContain(
      'v_latest_status_event_at <= v_manual_terminal_override_at'
    );
    expectReplacementDirection(
      readMigration(
        '20260804000300_repair_gigl_manual_failure_status_scope.sql'
      ),
      'v_latest_incoming_event_at <= v_manual_terminal_override_at',
      'v_latest_status_event_at <= v_manual_terminal_override_at'
    );
    expect(migration).toContain(
      'GIGL manual failure terminality must use status events'
    );
  });
});
