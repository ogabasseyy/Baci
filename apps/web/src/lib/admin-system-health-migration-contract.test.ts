import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151380_repair_admin_system_health_definitions.sql'
);
const migration = readFileSync(migrationPath, 'utf8');

describe('admin system health migration contract', () => {
  it('uses the live operations permission and a pinned definer boundary', () => {
    expect(migration).toContain('get_admin_system_health_v1');
    expect(migration).toContain("'operations.read'");
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("SET statement_timeout = '5s'");
  });

  it('revokes direct access and grants only the authenticated wrapper', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_admin_system_health_v1()'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_admin_system_health_v1()'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.get_missing_index_suggestions()'
    );
  });

  it('does not claim to test external storage or authentication services', () => {
    expect(migration).not.toContain('Storage is operational');
    expect(migration).not.toContain('Auth system is operational');
    expect(migration).not.toContain('service_role_key');
  });

  it('uses bounded probes for every major operations failure path', () => {
    expect(migration).toContain("'Payment side effects'");
    expect(migration).toContain("'Payout requests'");
    expect(migration).toContain("'Shipping operations'");
    expect(migration).toContain("'Event pipeline dead letters'");
    expect(migration).toContain("'Event pipeline workers'");
    expect(migration).toContain("status = 'dead_letter'");
    expect(migration).toContain("status = 'ingress_dead_letter'");
    expect(migration).toContain('side_effect.claimed_at IS NULL');
    expect(migration).toContain('order_outbox.locked_at IS NULL');
    expect(migration).toContain(
      "shipment.updated_at >= v_now - interval '24 hours'"
    );
    expect(migration).not.toContain("'delivery_attempt_failed', 'returned'");
    expect(migration).toContain("'bounded_existence'");
    expect(migration).not.toContain('count(*)');
  });

  it('does not flag cancelled or direct settlements as overdue', () => {
    expect(migration).toContain(
      'settlement.expected_settlement_date < v_now::date'
    );
    expect(migration).toContain(
      "'settled', 'paid', 'completed', 'credited', 'cancelled', 'direct'"
    );
  });

  it('covers every failed or stale notification delivery source', () => {
    expect(migration).toContain('public.email_send_attempts AS email_attempt');
    expect(migration).toContain(
      'public.push_notification_attempts AS push_attempt'
    );
    expect(migration).toContain(
      'public.order_notification_outbox AS order_outbox'
    );
    expect(migration).toContain(
      'public.shipment_tracking_notification_outbox AS tracking_outbox'
    );
    expect(migration).toContain(
      "push_attempt.status IN ('failed', 'partial_failure')"
    );
    expect(migration).toContain('tracking_outbox.locked_at IS NULL');
  });

  it('does not describe a recent heartbeat as a successful worker run', () => {
    expect(migration).toContain(
      'All observed worker heartbeats are recent with no newer recorded error.'
    );
    expect(migration).toContain(
      "'health_basis', 'recent_heartbeat_and_no_newer_error'"
    );
    expect(migration).not.toContain('recent successful heartbeats');
  });
});
