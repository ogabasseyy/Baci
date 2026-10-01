import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151420_harden_admin_event_pipeline_read_models.sql'
);

describe('event pipeline admin read model migration contract', () => {
  it('revokes raw authenticated reads and exposes only redacted v2 fields', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.list_event_pipeline_ingress_failures_v1'
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.list_event_pipeline_deliveries_v1'
    );
    expect(sql).toContain('list_event_pipeline_ingress_failures_admin_v2');
    expect(sql).toContain('list_event_pipeline_deliveries_admin_v2');
    expect(sql).toContain('get_event_pipeline_operations_admin_v2');
    expect(sql).toContain("'operations.read'");
    expect(sql).not.toMatch(
      /'failure_message'|'replay_reason'|'provider_response_id'|'external_event_id'/
    );
  });
});
