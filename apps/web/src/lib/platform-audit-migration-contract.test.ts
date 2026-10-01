import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), '../../supabase/migrations');
const ledgerMigrationPath = resolve(
  migrationDirectory,
  '20260805150300_platform_audit_events.sql'
);
const writerMigrationPath = resolve(
  migrationDirectory,
  '20260805150301_platform_audit_event_writers.sql'
);
const readerMigrationPath = resolve(
  migrationDirectory,
  '20260805150302_platform_audit_event_reader.sql'
);
const indexMigrationPath = resolve(
  migrationDirectory,
  '20260805150310_platform_audit_reader_indexes.sql'
);
const firstAccessMigrationPath = resolve(
  migrationDirectory,
  '20260805150700_platform_admin_membership_management_list.sql'
);
const hardeningMigrationPath = resolve(
  migrationDirectory,
  '20260805151570_harden_admin_error_code_projections.sql'
);

describe('platform audit migration contract', () => {
  it('keeps the operator ledger immutable, private, and safely projected', async () => {
    const [ledgerMigration, writerMigration, readerMigration] =
      await Promise.all(
        [ledgerMigrationPath, writerMigrationPath, readerMigrationPath].map(
          (path) => readFile(path, 'utf8')
        )
      );

    expect(ledgerMigration).toContain(
      'CREATE TABLE public.platform_audit_events'
    );
    expect(ledgerMigration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(ledgerMigration).toContain('FORCE ROW LEVEL SECURITY');
    expect(ledgerMigration).toContain(
      'REVOKE ALL ON TABLE public.platform_audit_events'
    );
    expect(writerMigration).toContain(
      'BEFORE UPDATE OR DELETE ON public.platform_audit_events'
    );
    expect(readerMigration).toContain('list_platform_audit_events_v1');
    expect(writerMigration).toContain('write_platform_audit_event_v1');
    expect(writerMigration).toContain('write_platform_audit_export_event_v1');
    expect(writerMigration).toContain(
      'FUNCTION public.write_platform_audit_export_event_v1()'
    );
    expect(ledgerMigration).toContain(
      'idx_platform_audit_events_global_occurred_id'
    );
    expect(ledgerMigration).not.toContain(
      'idx_audit_events_global_occurred_id'
    );
    expect(writerMigration).toContain(
      'private.has_platform_admin_permission_v1'
    );
    expect(readerMigration).toContain(
      'private.has_platform_admin_permission_v1'
    );
    expect(readerMigration).toContain("'audit.read'");
    expect(writerMigration).toContain("'roles.manage'");
    expect(writerMigration).toContain("'audit.exported'");
    expect(writerMigration).toContain("'platform_audit_timeline'");
    expect(
      `${ledgerMigration}\n${writerMigration}\n${readerMigration}`
    ).not.toContain('merchant.is_platform_admin IS TRUE');
    expect(`${writerMigration}\n${readerMigration}`).toContain(
      "SET search_path = ''"
    );
    expect(readerMigration).not.toContain('FROM public.audit_logs');
    expect(readerMigration).not.toContain('before_values');
    expect(readerMigration).not.toContain('after_values');
  });

  it('builds indexes on the live canonical ledger without blocking writes', async () => {
    const migration = await readFile(indexMigrationPath, 'utf8');

    expect(migration).toContain('-- disable-transaction');
    expect(migration).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_global_occurred_id'
    );
    expect(migration).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_global_action_occurred_id'
    );
    expect(migration).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_global_resource_type_occurred_id'
    );
  });

  it('keeps the audit-export grant fixed-shape and caller-value free', async () => {
    const migration = await readFile(writerMigrationPath, 'utf8');
    const exportWriter = migration.match(
      /CREATE OR REPLACE FUNCTION public\.write_platform_audit_export_event_v1\(\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.write_platform_audit_export_event_v1\(\)[\s\S]*?TO authenticated;/
    )?.[0];

    expect(exportWriter).toBeDefined();
    expect(exportWriter).toContain("'audit.exported'");
    expect(exportWriter).toContain("'audit_timeline'");
    expect(exportWriter).toContain("'platform_audit_timeline'");
    expect(exportWriter).toContain("'audit.read'");
    expect(exportWriter).not.toMatch(/\bp_(action|resource|metadata)\b/);
    expect(exportWriter).not.toContain('TO anon');
    expect(exportWriter).not.toContain('TO service_role');
  });

  it('removes the unused caller-shaped audit writer from the active surface', async () => {
    const migration = await readFile(hardeningMigrationPath, 'utf8');

    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.write_platform_audit_event_v1'
    );
    expect(migration).toContain(
      'DROP FUNCTION public.write_platform_audit_event_v1'
    );
  });

  it('accepts only an all-null or fully populated keyset cursor', async () => {
    const migration = await readFile(readerMigrationPath, 'utf8');
    const reader = migration.match(
      /CREATE OR REPLACE FUNCTION public\.list_platform_audit_events_v1\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.list_platform_audit_events_v1\([\s\S]*?TO authenticated;/
    )?.[0];

    expect(reader).toBeDefined();
    expect(reader).toContain('p_before_occurred_at IS NULL');
    expect(reader).toContain('p_before_event_source IS NULL');
    expect(reader).toContain('p_before_event_id IS NULL');
    expect(reader).toContain('p_before_occurred_at IS NOT NULL');
    expect(reader).toContain('p_before_event_source IS NOT NULL');
    expect(reader).toContain('p_before_event_id IS NOT NULL');
    expect(reader).not.toContain(
      '(p_before_event_source IS NULL OR p_before_event_id IS NULL)'
    );
  });

  it('keeps each dependency-safe task migration bounded before later access migrations', async () => {
    const auditMigrations = await Promise.all(
      [
        ledgerMigrationPath,
        writerMigrationPath,
        readerMigrationPath,
        indexMigrationPath,
        hardeningMigrationPath,
      ].map((path) => readFile(path, 'utf8'))
    );

    for (const source of auditMigrations) {
      expect(source.split('\n').length).toBeLessThanOrEqual(300);
    }

    for (const source of auditMigrations.slice(0, 3)) {
      expect(source).toContain('BEGIN;');
      expect(source).toContain('COMMIT;');
    }

    expect(ledgerMigrationPath).toContain('20260805150300_');
    expect(writerMigrationPath).toContain('20260805150301_');
    expect(readerMigrationPath).toContain('20260805150302_');
    expect(readerMigrationPath < indexMigrationPath).toBe(true);
    expect(ledgerMigrationPath < firstAccessMigrationPath).toBe(true);
  });
});
