import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151570_harden_admin_error_code_projections.sql'
);

describe('admin error-code projection migration contract', () => {
  it('replaces raw admin diagnostics with a closed error-code vocabulary', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('private.project_admin_error_code_v1');
    expect(sql).toContain("ELSE 'unclassified_error'");
    expect(sql).toContain('list_event_pipeline_ingress_failures_admin_v3');
    expect(sql).toContain('list_event_pipeline_deliveries_admin_v3');
    expect(sql).toContain('get_event_pipeline_operations_admin_v3');
    expect(sql).toContain('get_admin_operations_v2');
    expect(sql).toContain("item.value - 'worker_id'");
    expect(sql).toContain("item.value - 'workerId'");
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.get_admin_operations_v1'
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.get_event_pipeline_operations_admin_v2'
    );
    expect(sql).toContain("SET search_path = ''");
    expect(sql.split('\n').length).toBeLessThanOrEqual(300);
  });
});
