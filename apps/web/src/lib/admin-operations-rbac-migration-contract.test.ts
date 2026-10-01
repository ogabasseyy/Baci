import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151200_harden_admin_operations_rbac.sql'
);

describe('admin operations RBAC migration contract', () => {
  it('maps legacy event-pipeline reads to operations.read', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('eventing.is_event_pipeline_operator_v1()');
    expect(sql).toContain("'operations.read'");
    expect(sql).not.toContain('merchant.is_platform_admin');
    expect(sql).not.toContain('merchants.is_platform_admin');
  });

  it('keeps replay management-only and removes authenticated access to legacy replay entry points', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain("'operations.manage'");
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.replay_ingress_dead_letter_v1\([\s\S]*?FROM authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.replay_event_delivery_v1\([\s\S]*?FROM authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.replay_event_deliveries_batch_v1\([\s\S]*?FROM authenticated;/
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.select_event_pipeline_replay_ids_v1\([\s\S]*?FROM authenticated;/
    );
  });

  it('writes fixed privacy-safe audit events and never accepts caller-shaped audit fields', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain("'event_pipeline.ingress_replayed'");
    expect(sql).toContain("'event_pipeline.delivery_batch_replayed'");
    expect(sql).toContain("'category', 'operations'");
    expect(sql).toContain("'operation', 'replay'");
    expect(sql).toContain("'result', 'succeeded'");
    expect(sql).not.toMatch(/p_(action|metadata|resource_type|resource_id)/);
    expect(sql).not.toContain("'reason', p_replay_reason");
    expect(sql).not.toContain("'reason_code', p_replay_reason");
    expect(sql).toMatch(
      /replay_ingress_dead_letter_admin_v2\([\s\S]*?RETURNS integer[\s\S]*?RETURN 1;/
    );
  });

  it('bounds admin work and removes service-role access to the operations read model', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain("SET statement_timeout = '5s'");
    expect(sql).toContain("SET statement_timeout = '10s'");
    expect(sql).toContain("SET statement_timeout = '15s'");
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.get_admin_operations_v1\([\s\S]*?FROM service_role;/
    );
  });
});
